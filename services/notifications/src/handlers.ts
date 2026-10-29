import {
  COL,
  GRUPOS,
  TOPICS,
  idNotificacion,
  type EventoAlertaSla,
  type EventoEstado,
  type EventoNotificacion,
  type HandlerContext,
  type EventMeta,
  type MotivoFallo,
} from "@rutasur/shared";

const MENSAJES: Record<MotivoFallo, string> = {
  AUSENTE:
    "No pudimos entregar tu envio: el destinatario no estaba. Podes reprogramar la entrega.",
  DIRECCION_INCORRECTA:
    "No pudimos entregar tu envio: la direccion es incorrecta. Contactanos para corregirla.",
  RECHAZADO: "El envio fue rechazado en el domicilio y se devuelve al comercio.",
  ZONA_INACCESIBLE:
    "No pudimos acceder a la zona de entrega. Vamos a coordinar un nuevo intento.",
};

function telefono(shipmentId: string): string {
  const digitos = shipmentId.replace(/\D/g, "").padStart(4, "0").slice(-4);
  return `+54 9 11 ****-${digitos}`;
}

/**
 * CU2 - reaccion 1: registra el aviso al destinatario y lo publica para que el
 * proyector lo muestre en el detalle del envio.
 */
export async function handleEstado(
  payload: EventoEstado,
  meta: EventMeta,
  ctx: HandlerContext,
): Promise<void> {
  if (payload.tipo !== "ENTREGA_FALLIDA" || !payload.motivo) return;

  const notificacionId = idNotificacion(payload.shipmentId, payload.eventId);
  const evento: EventoNotificacion = {
    eventId: `evt-${notificacionId}`,
    shipmentId: payload.shipmentId,
    tipo: "NOTIFICACION_ENVIADA",
    ocurridoEn: payload.ocurridoEn,
    secuencia: payload.secuencia,
    version: 1,
    hubId: payload.hubId ?? null,
    zonaId: payload.zonaId ?? null,
    repartidorId: payload.repartidorId ?? null,
    notificacionId,
    categoria: payload.motivo === "AUSENTE" ? "REPROGRAMACION" : "FALLO",
    canal: "SMS",
    destinatario: telefono(payload.shipmentId),
    mensaje: `${MENSAJES[payload.motivo]} (${payload.shipmentId})`,
    origenEventId: payload.eventId,
  };

  await ctx.producer.enviar(TOPICS.notificaciones, payload.shipmentId, evento);
  ctx.logger.info(
    { eventId: payload.eventId, particion: meta.partition, offset: meta.offset },
    "notificacion de fallo publicada",
  );
}

/** CU2/CU3: avisa al supervisor cuando se abre una alerta de SLA. */
export async function handleAlerta(
  payload: EventoAlertaSla,
  meta: EventMeta,
  ctx: HandlerContext,
): Promise<void> {
  if (payload.estado !== "ABIERTA") return;

  const notificacionId = idNotificacion(payload.shipmentId, payload.alertaId);
  const evento: EventoNotificacion = {
    eventId: `evt-${notificacionId}`,
    shipmentId: payload.shipmentId,
    tipo: "NOTIFICACION_ENVIADA",
    ocurridoEn: payload.ocurridoEn,
    secuencia: payload.secuencia,
    version: 1,
    hubId: payload.hubId ?? null,
    zonaId: payload.zonaId ?? null,
    notificacionId,
    categoria: "ALERTA_SLA",
    canal: "INTERNO",
    destinatario: "supervisor@rutasur",
    mensaje: `Alerta ${payload.prioridad} (${payload.regla}) para ${payload.shipmentId}: ${payload.causa}`,
    origenEventId: payload.eventId,
  };

  await ctx.producer.enviar(TOPICS.notificaciones, payload.shipmentId, evento);
  ctx.logger.info(
    { eventId: payload.eventId, particion: meta.partition, offset: meta.offset },
    "notificacion interna de alerta publicada",
  );
}
