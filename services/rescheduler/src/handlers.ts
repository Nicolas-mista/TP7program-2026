import {
  COL,
  TOPICS,
  decidirReprogramacion,
  type DocumentoPendiente,
  type EventoEstado,
  type EventoReprogramacion,
  type HandlerContext,
  type EventMeta,
} from "@rutasur/shared";

/**
 * CU2 - reaccion 2: decide el proximo intento segun el motivo y la cantidad de
 * intentos, publica la decision y deja el reintento agendado en MongoDB para
 * que el simulador (el mundo fisico) lo ejecute a su hora.
 */
export async function handleEstado(
  payload: EventoEstado,
  meta: EventMeta,
  ctx: HandlerContext,
): Promise<void> {
  if (payload.tipo !== "ENTREGA_FALLIDA" || !payload.motivo) {
    if (payload.tipo === "ENTREGADO" || payload.tipo === "EN_REPARTO") {
      await cancelarPendientes(ctx, payload.shipmentId, payload.intento ?? 1);
    }
    return;
  }

  const intento = payload.intento ?? 1;
  const ocurridoEn = new Date(payload.ocurridoEn);
  const decision = decidirReprogramacion(payload.motivo, intento, ocurridoEn);
  const intentoNuevo = intento + 1;

  if (decision.decision === "REINTENTO" && decision.fechaProgramada) {
    const pendiente: DocumentoPendiente = {
      _id: `${payload.shipmentId}-${intentoNuevo}`,
      shipmentId: payload.shipmentId,
      intentoOrigen: intento,
      intentoNuevo,
      decision: decision.decision,
      motivo: payload.motivo,
      programadaPara: decision.fechaProgramada,
      franja: decision.franja,
      estado: "PENDIENTE",
      ultimaSecuencia: payload.secuencia,
      hubId: payload.hubId ?? null,
      zonaId: payload.zonaId ?? null,
      repartidorId: payload.repartidorId ?? null,
      actualizadoEn: new Date(),
    };

    // actualizadoEn se escribe en $set, asi que no puede repetirse dentro de
    // $setOnInsert: MongoDB rechaza el update por conflicto de paths.
    const { actualizadoEn: _actualizadoEn, ...insert } = pendiente;
    await ctx.db.collection<DocumentoPendiente>(COL.pendientes).updateOne(
      { _id: pendiente._id },
      { $setOnInsert: insert, $set: { actualizadoEn: new Date() } },
      { upsert: true },
    );
  } else {
    await cancelarPendientes(ctx, payload.shipmentId, intentoNuevo);
  }

  const evento: EventoReprogramacion = {
    eventId: `rpg-${payload.eventId}`,
    shipmentId: payload.shipmentId,
    tipo: "REPROGRAMACION",
    ocurridoEn: payload.ocurridoEn,
    secuencia: payload.secuencia,
    version: 1,
    hubId: payload.hubId ?? null,
    zonaId: payload.zonaId ?? null,
    repartidorId: payload.repartidorId ?? null,
    intento,
    decision: decision.decision,
    motivo: payload.motivo,
    fechaProgramada: decision.fechaProgramada?.toISOString() ?? null,
    franja: decision.franja,
    detalle: decision.detalle,
    origenEventId: payload.eventId,
  };

  await ctx.producer.enviar(TOPICS.reprogramaciones, payload.shipmentId, evento);
  ctx.logger.info(
    {
      eventId: payload.eventId,
      particion: meta.partition,
      offset: meta.offset,
      decision: decision.decision,
      intento,
    },
    "decision de reprogramacion publicada",
  );
}

async function cancelarPendientes(
  ctx: HandlerContext,
  shipmentId: string,
  intentoMaximo: number,
): Promise<void> {
  await ctx.db.collection<DocumentoPendiente>(COL.pendientes).updateMany(
    {
      shipmentId,
      estado: "PENDIENTE",
      intentoNuevo: { $lte: intentoMaximo },
    },
    { $set: { estado: "CANCELADA", actualizadoEn: new Date() } },
  );
}
