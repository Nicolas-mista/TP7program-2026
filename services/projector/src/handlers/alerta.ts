import {
  COL,
  type DocumentoAlerta,
  type EventoAlertaSla,
  type HandlerContext,
  type EventMeta,
} from "@rutasur/shared";

export async function handleAlerta(
  payload: EventoAlertaSla,
  _meta: EventMeta,
  ctx: HandlerContext,
): Promise<void> {
  const ocurridoEn = new Date(payload.ocurridoEn);
  const venceEn = new Date(payload.venceEn);

  const set: Record<string, unknown> = {
    alertaId: payload.alertaId,
    shipmentId: payload.shipmentId,
    regla: payload.regla,
    prioridad: payload.prioridad,
    causa: payload.causa,
    estado: payload.estado,
    venceEn,
    hubId: payload.hubId ?? null,
    zonaId: payload.zonaId ?? null,
    actualizadoEn: new Date(),
  };

  const update: Record<string, unknown> = {
    $set: set,
    $setOnInsert: { abiertaEn: ocurridoEn },
  };

  if (payload.estado === "CERRADA") {
    set.cerradaEn = ocurridoEn;
  } else {
    update.$unset = { cerradaEn: "" };
  }

  await ctx.db
    .collection<DocumentoAlerta>(COL.alertas)
    .updateOne({ _id: payload.alertaId }, update, { upsert: true });
}
