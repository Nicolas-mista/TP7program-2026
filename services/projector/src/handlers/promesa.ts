import {
  COL,
  type DocumentoEnvio,
  type EventoPromesa,
  type HandlerContext,
  type EventMeta,
} from "@rutasur/shared";

/**
 * La promesa de entrega se proyecta en el documento del envio para que la
 * torre de control y el tracking publico muestren la fecha estimada.
 */
export async function handlePromesa(
  payload: EventoPromesa,
  _meta: EventMeta,
  ctx: HandlerContext,
): Promise<void> {
  const ocurridoEn = new Date(payload.ocurridoEn);
  const venceEn = new Date(payload.promesa.venceEn);

  await ctx.db.collection<DocumentoEnvio>(COL.envios).updateOne(
    { _id: payload.shipmentId },
    {
      $set: {
        promesa: {
          venceEn,
          franja: payload.promesa.franja,
          compromiso: payload.promesa.compromiso,
        },
        actualizadoEn: new Date(),
      },
      $setOnInsert: {
        shipmentId: payload.shipmentId,
        estado: "CREADO",
        estadoDesde: ocurridoEn,
        intento: 1,
        hubId: payload.hubId ?? null,
        zonaId: payload.zonaId ?? null,
        repartidorId: payload.repartidorId ?? null,
        historial: [],
        reprogramaciones: [],
        ultimaSecuencia: 0,
        ultimoEventoEn: ocurridoEn,
        creadoEn: ocurridoEn,
      },
    },
    { upsert: true },
  );
}
