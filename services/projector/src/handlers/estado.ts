import {
  COL,
  type DocumentoEnvio,
  type EventoEstado,
  type HandlerContext,
  type EventMeta,
} from "@rutasur/shared";

/**
 * CU1: mantiene el documento del envio con el ultimo estado y el historial.
 *
 * Regla de orden: un evento con secuencia menor o igual a la aplicada se
 * descarta. El filtro del update + el indice unico de _id implementan la regla
 * sin necesidad de leer antes de escribir.
 */
export async function handleEstado(
  payload: EventoEstado,
  _meta: EventMeta,
  ctx: HandlerContext,
): Promise<void> {
  const ocurridoEn = new Date(payload.ocurridoEn);
  const intento = payload.intento ?? 1;
  const entrada = {
    eventId: payload.eventId,
    tipo: payload.tipo,
    ocurridoEn,
    secuencia: payload.secuencia,
    intento,
    ...(payload.motivo ? { motivo: payload.motivo } : {}),
  };

  const set: Record<string, unknown> = {
    shipmentId: payload.shipmentId,
    estado: payload.tipo,
    estadoDesde: ocurridoEn,
    intento,
    hubId: payload.hubId ?? null,
    zonaId: payload.zonaId ?? null,
    repartidorId: payload.repartidorId ?? null,
    ultimoEventoEn: ocurridoEn,
    actualizadoEn: new Date(),
  };
  if (payload.motivo) set.ultimoMotivo = payload.motivo;

  // Al salir a reparto el reintento agendado ya se ejecuto; al entregar, el
  // circuito se cierra. En ambos casos el proximo intento deja de existir.
  const unset: Record<string, ""> | undefined =
    payload.tipo === "EN_REPARTO" || payload.tipo === "ENTREGADO"
      ? { proximoIntento: "" }
      : undefined;

  try {
    await ctx.db.collection<DocumentoEnvio>(COL.envios).updateOne(
      {
        _id: payload.shipmentId,
        $or: [
          { ultimaSecuencia: { $lt: payload.secuencia } },
          { ultimaSecuencia: { $exists: false } },
        ],
      },
      {
        $set: set,
        ...(unset ? { $unset: unset } : {}),
        $max: { ultimaSecuencia: payload.secuencia },
        $push: { historial: { $each: [entrada], $slice: -30 } },
        $setOnInsert: {
          // shipmentId ya viaja en $set; repetirlo aca haria que MongoDB
          // rechace el upsert por conflicto de paths.
          creadoEn: ocurridoEn,
          reprogramaciones: [],
        },
      },
      { upsert: true },
    );
  } catch (error) {
    // El upsert choca con el _id existente cuando el evento esta atrasado.
    if ((error as { code?: number }).code === 11000) {
      ctx.logger.debug(
        { shipmentId: payload.shipmentId, secuencia: payload.secuencia },
        "evento fuera de orden descartado",
      );
      return;
    }
    throw error;
  }
}
