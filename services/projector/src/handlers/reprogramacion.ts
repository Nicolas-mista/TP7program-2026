import {
  COL,
  type DocumentoEnvio,
  type EventoReprogramacion,
  type HandlerContext,
  type EventMeta,
} from "@rutasur/shared";

export async function handleReprogramacion(
  payload: EventoReprogramacion,
  _meta: EventMeta,
  ctx: HandlerContext,
): Promise<void> {
  const ocurridoEn = new Date(payload.ocurridoEn);
  const fechaProgramada = payload.fechaProgramada ? new Date(payload.fechaProgramada) : null;

  const set: Record<string, unknown> = { actualizadoEn: new Date() };
  let unset: Record<string, ""> | undefined;
  if (payload.decision === "REINTENTO" && fechaProgramada && payload.franja) {
    set.proximoIntento = {
      fechaProgramada,
      franja: payload.franja,
      intento: payload.intento + 1,
    };
  } else {
    // Devolucion o retencion: ya no hay un proximo intento agendado.
    unset = { proximoIntento: "" };
  }
  if (payload.decision === "DEVOLUCION") set.devolucion = true;
  if (payload.decision === "RETENIDO") set.retenido = true;

  try {
    await ctx.db.collection<DocumentoEnvio>(COL.envios).updateOne(
      { _id: payload.shipmentId, "reprogramaciones.eventId": { $ne: payload.eventId } },
      {
        $push: {
          reprogramaciones: {
            $each: [
              {
                eventId: payload.eventId,
                intento: payload.intento,
                decision: payload.decision,
                motivo: payload.motivo,
                fechaProgramada,
                franja: payload.franja,
                detalle: payload.detalle,
                ocurridoEn,
              },
            ],
            $slice: -10,
          },
        },
        $set: set,
        ...(unset ? { $unset: unset } : {}),
      },
      { upsert: false },
    );
  } catch (error) {
    if ((error as { code?: number }).code === 11000) return;
    throw error;
  }
}
