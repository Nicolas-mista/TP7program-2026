import type { Logger } from "pino";
import { TOPICS } from "../topics";
import type { EventoDlq } from "../events/types";
import type { EventProducer } from "./producer";

export interface DatosDlq {
  consumidor: string;
  topic: string;
  partition: number;
  offset: string;
  motivo: "JSON_INVALIDO" | "ESQUEMA_INVALIDO" | "ERROR_DE_PROCESAMIENTO" | string;
  error: string;
  original: string;
}

/**
 * Publica el evento rechazado en la DLQ y devuelve el control al consumidor
 * para que continue con el siguiente mensaje.
 */
export async function enviarDlq(
  producer: EventProducer,
  logger: Logger,
  datos: DatosDlq,
): Promise<void> {
  const evento: EventoDlq = {
    eventId: `dlq-${datos.consumidor}-${datos.topic}-${datos.partition}-${datos.offset}`,
    tipo: "EVENTO_RECHAZADO",
    ocurridoEn: new Date().toISOString(),
    version: 1,
    consumidor: datos.consumidor,
    topic: datos.topic,
    partition: datos.partition,
    offset: datos.offset,
    motivo: datos.motivo,
    error: datos.error.slice(0, 2000),
    original: datos.original.slice(0, 20_000),
  };

  try {
    await producer.enviar(TOPICS.dlq, evento.eventId, evento);
    logger.warn(
      {
        consumidor: datos.consumidor,
        topic: datos.topic,
        particion: datos.partition,
        offset: datos.offset,
        motivo: datos.motivo,
      },
      "evento enviado a la DLQ",
    );
  } catch (error) {
    logger.error(
      { error: (error as Error).message, original: datos.original.slice(0, 300) },
      "no se pudo publicar en la DLQ",
    );
  }
}
