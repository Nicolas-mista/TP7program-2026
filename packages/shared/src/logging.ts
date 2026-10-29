import pino, { type Logger } from "pino";

export type { Logger };

export function createLogger(servicio: string): Logger {
  return pino({
    name: servicio,
    level: process.env.LOG_LEVEL ?? "info",
    base: { servicio },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

export function logEvento(
  logger: Logger,
  consumidor: string,
  meta: { topic: string; partition: number; offset: string; eventId?: string },
  msg: string,
  extra: Record<string, unknown> = {},
): void {
  logger.info(
    {
      consumidor,
      topic: meta.topic,
      particion: meta.partition,
      offset: meta.offset,
      eventId: meta.eventId,
      ...extra,
    },
    msg,
  );
}
