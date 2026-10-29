import {
  COL,
  type DocumentoNotificacion,
  type EventoNotificacion,
  type HandlerContext,
  type EventMeta,
} from "@rutasur/shared";

export async function handleNotificacion(
  payload: EventoNotificacion,
  _meta: EventMeta,
  ctx: HandlerContext,
): Promise<void> {
  const doc: DocumentoNotificacion = {
    _id: payload.notificacionId,
    notificacionId: payload.notificacionId,
    shipmentId: payload.shipmentId,
    categoria: payload.categoria,
    canal: payload.canal,
    destinatario: payload.destinatario,
    mensaje: payload.mensaje,
    enviadaEn: new Date(payload.ocurridoEn),
    origenEventId: payload.origenEventId,
  };

  try {
    await ctx.db.collection<DocumentoNotificacion>(COL.notificaciones).insertOne(doc);
  } catch (error) {
    if ((error as { code?: number }).code === 11000) return;
    throw error;
  }
}
