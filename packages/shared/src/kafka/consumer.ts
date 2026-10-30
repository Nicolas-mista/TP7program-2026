import type { ClientSession, Db } from "mongodb";
import { mongoClient } from "../db/client";
import type { Consumer, Kafka, KafkaMessage } from "kafkajs";
import type { Logger } from "pino";
import { COL } from "../db/collections";
import { validarEvento } from "../events/validate";
import { simClock } from "../time/sim-clock";
import { enviarDlq } from "./dlq";
import type { EventProducer } from "./producer";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
/** Cantidad de mensajes procesados entre commits manuales de offset. */
const COMMIT_CADA = 100;

export interface EventMeta {
  topic: string;
  partition: number;
  offset: string;
  key: string | null;
}

export interface HandlerContext {
  db: Db;
  producer: EventProducer;
  logger: Logger;
  servicio: string;
}

export type EventHandler = (
  payload: any,
  meta: EventMeta,
  ctx: HandlerContext,
  session?: ClientSession,
) => Promise<void>;

export interface ConsumerServiceOptions {
  servicio: string;
  groupId: string;
  topics: string[];
  handler: EventHandler;
  db: Db;
  producer: EventProducer;
  logger: Logger;
  fromBeginning?: boolean;
  /** Usa una transaccion de MongoDB para aplicar el handler y registrar el eventId. */
  transactional?: boolean;
  /** Se ejecuta antes de borrar el grupo en un rebuild (drop de colecciones, etc). */
  onBeforeRebuild?: () => Promise<void>;
}

/**
 * Consumidor con las garantias del trabajo:
 *  - validacion de esquema por topic,
 *  - DLQ ante JSON invalido, esquema invalido o error de procesamiento,
 *  - idempotencia por (consumidor, eventId),
 *  - commit manual del offset recien despues de escribir en MongoDB.
 */
export class ConsumerService {
  private consumer: Consumer | null = null;
  private fromBeginning: boolean;
  private rebuildEnCurso: Promise<void> | null = null;

  constructor(
    private readonly kafka: Kafka,
    private readonly opts: ConsumerServiceOptions,
  ) {
    // Si el grupo no tiene offsets, arranca desde el inicio del topic: asi no
    // se pierden eventos publicados antes de que el consumidor se conecte.
    this.fromBeginning = opts.fromBeginning ?? true;
  }

  get groupId(): string {
    return this.opts.groupId;
  }

  private contexto(): HandlerContext {
    return {
      db: this.opts.db,
      producer: this.opts.producer,
      logger: this.opts.logger,
      servicio: this.opts.servicio,
    };
  }

  async start(): Promise<void> {
    const { groupId, topics, logger } = this.opts;
    const consumer = this.kafka.consumer({
      groupId,
      sessionTimeout: 30_000,
      heartbeatInterval: 3_000,
      rebalanceTimeout: 60_000,
      maxBytesPerPartition: 2 * 1024 * 1024,
    });
    this.consumer = consumer;
    await consumer.connect();
    for (const topic of topics) {
      await consumer.subscribe({ topic, fromBeginning: this.fromBeginning });
    }
    await consumer.run({
      autoCommit: false,
      eachBatchAutoResolve: false,
      // Procesa las tres particiones en paralelo: con una sola, un consumidor
      // no alcanza el ritmo del simulador y el lag crece sin limite.
      partitionsConsumedConcurrently: 3,
      // El commit sigue siendo manual y posterior a la escritura en MongoDB,
      // pero se agrupa cada COMMIT_CADA mensajes para no pagar un round-trip
      // a Kafka por cada evento.
      eachBatch: async ({ batch, resolveOffset }) => {
        let ultimoOffset: string | null = null;
        let sinCommitear = 0;
        for (const message of batch.messages) {
          await this.procesar({ topic: batch.topic, partition: batch.partition, message });
          resolveOffset(message.offset);
          ultimoOffset = message.offset;
          sinCommitear += 1;
          if (sinCommitear >= COMMIT_CADA) {
            await this.commit(batch.topic, batch.partition, ultimoOffset);
            sinCommitear = 0;
          }
        }
        if (ultimoOffset && sinCommitear > 0) {
          await this.commit(batch.topic, batch.partition, ultimoOffset);
        }
      },
    });
    logger.info({ grupo: groupId, topics, desdeInicio: this.fromBeginning }, "consumidor iniciado");
  }

  async stop(): Promise<void> {
    const consumer = this.consumer;
    this.consumer = null;
    if (consumer) {
      await consumer.disconnect().catch(() => undefined);
    }
  }

  async rebuild(): Promise<void> {
    if (this.rebuildEnCurso) return this.rebuildEnCurso;
    this.rebuildEnCurso = (async () => {
      const { groupId, logger } = this.opts;
      logger.info({ grupo: groupId }, "rebuild: deteniendo consumidor");
      await this.stop();
      await this.opts.onBeforeRebuild?.();
      // El simulador puede haber reiniciado su reloj (reset de demo). Si el
      // consumidor conserva el tiempo de la corrida anterior, el monitor de SLA
      // evalua contra un "ahora" futuro y dispara alertas falsas. Al reiniciar
      // el reloj, el primer evento reprocesado vuelve a fijar la hora.
      simClock().reiniciar();
      const admin = this.kafka.admin();
      await admin.connect();
      try {
        let borrado = false;
        let ultimoError: unknown;
        // deleteGroups falla si el grupo todavia tiene miembros; disconnect ya
        // los saco, pero se reintenta por si el coordinador tarda en liberarlo.
        for (let intento = 0; intento < 3 && !borrado; intento += 1) {
          try {
            await admin.deleteGroups([groupId]);
            borrado = true;
          } catch (error) {
            ultimoError = error;
            if (intento < 2) await sleep(500 * (intento + 1));
          }
        }
        if (borrado) {
          logger.info({ grupo: groupId }, "rebuild: offsets del grupo borrados");
        } else {
          logger.warn(
            { grupo: groupId, error: (ultimoError as Error)?.message },
            "rebuild: no se pudo borrar el grupo",
          );
        }
      } finally {
        await admin.disconnect();
      }
      this.fromBeginning = true;
      await this.start();
      logger.info({ grupo: groupId }, "rebuild: reprocesando desde el inicio del topic");
    })().finally(() => {
      this.rebuildEnCurso = null;
    });
    return this.rebuildEnCurso;
  }

  private async commit(topic: string, partition: number, offset: string): Promise<void> {
    try {
      await this.consumer?.commitOffsets([
        { topic, partition, offset: String(Number(offset) + 1) },
      ]);
    } catch (error) {
      this.opts.logger.warn(
        { error: (error as Error).message, topic, partition, offset },
        "no se pudo commitear el offset",
      );
    }
  }

  private async registrarProcesado(payload: any, meta: EventMeta, session?: ClientSession): Promise<void> {
    const eventId =
      typeof payload?.eventId === "string" && payload.eventId.length > 0
        ? payload.eventId
        : `sin-id-${meta.topic}-${meta.partition}-${meta.offset}`;
    await this.opts.db.collection(COL.procesados).updateOne(
      { consumidor: this.opts.groupId, eventId },
      {
        $setOnInsert: {
          consumidor: this.opts.groupId,
          eventId,
          topic: meta.topic,
          partition: meta.partition,
          offset: meta.offset,
          procesadoEn: new Date(),
        },
      },
      { upsert: true, session },
    );
  }

  private async aplicar(payload: any, meta: EventMeta): Promise<void> {
    const { groupId, db, handler, logger } = this.opts;
    const eventId: string | undefined =
      typeof payload?.eventId === "string" && payload.eventId.length > 0 ? payload.eventId : undefined;

    if (this.opts.transactional) {
      const session = mongoClient().startSession();
      try {
        await session.withTransaction(async () => {
          if (eventId) {
            const ya = await db
              .collection(COL.procesados)
              .findOne({ consumidor: groupId, eventId }, { session });
            if (ya) return;
          }
          await handler(payload, meta, this.contexto(), session);
          await this.registrarProcesado(payload, meta, session);
        });
      } finally {
        await session.endSession();
      }
      return;
    }

    if (eventId) {
      const ya = await db.collection(COL.procesados).findOne({ consumidor: groupId, eventId });
      if (ya) {
        logger.debug({ eventId, grupo: groupId }, "evento ya procesado: se descarta");
        return;
      }
    }

    await handler(payload, meta, this.contexto());
    await this.registrarProcesado(payload, meta);
  }

  private async procesar({
    topic,
    partition,
    message,
  }: {
    topic: string;
    partition: number;
    message: KafkaMessage;
  }): Promise<void> {
    const { groupId, logger, producer } = this.opts;
    const meta: EventMeta = {
      topic,
      partition,
      offset: message.offset,
      key: message.key?.toString() ?? null,
    };
    const raw = message.value?.toString("utf8") ?? "";

    try {
      if (!raw.trim()) {
        return;
      }

      let payload: any;
      try {
        payload = JSON.parse(raw);
      } catch (error) {
        await enviarDlq(producer, logger, {
          consumidor: groupId,
          topic,
          partition,
          offset: message.offset,
          motivo: "JSON_INVALIDO",
          error: (error as Error).message,
          original: raw,
        });
        return;
      }

      const validacion = validarEvento(topic, payload);
      if (!validacion.ok) {
        await enviarDlq(producer, logger, {
          consumidor: groupId,
          topic,
          partition,
          offset: message.offset,
          motivo: "ESQUEMA_INVALIDO",
          error: validacion.errores.join(" | "),
          original: raw,
        });
        return;
      }

      if (typeof payload?.ocurridoEn === "string") {
        const fecha = new Date(payload.ocurridoEn);
        if (!Number.isNaN(fecha.getTime())) simClock().observe(fecha);
      }

      try {
        await this.aplicar(payload, meta);
      } catch (error) {
        let ultimo: unknown = error;
        let ok = false;
        for (let intento = 0; intento < 2 && !ok; intento += 1) {
          await sleep(200 * (intento + 1));
          try {
            await this.aplicar(payload, meta);
            ok = true;
          } catch (e) {
            ultimo = e;
          }
        }
        if (!ok) {
          await enviarDlq(producer, logger, {
            consumidor: groupId,
            topic,
            partition,
            offset: message.offset,
            motivo: "ERROR_DE_PROCESAMIENTO",
            error: String((ultimo as Error)?.stack ?? ultimo),
            original: raw,
          });
        }
      }
    } catch (error) {
      logger.error(
        { error: (error as Error).message, topic, partition, offset: message.offset },
        "error inesperado procesando el mensaje",
      );
    }
  }
}
