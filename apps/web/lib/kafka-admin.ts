import { Kafka } from "kafkajs";
import type { LagGrupoView } from "./types";

export const GRUPOS_MONITOREADOS = [
  "proyector",
  "notificaciones",
  "reprogramacion",
  "monitor-sla",
  "analitica",
  "analitica-replay",
];

function crearKafka(): Kafka {
  return new Kafka({
    clientId: "rutasur-web",
    brokers: (process.env.KAFKA_BROKERS ?? "localhost:9092").split(",").map((b) => b.trim()),
    connectionTimeout: 5_000,
    requestTimeout: 10_000,
    retry: { retries: 3, initialRetryTime: 250 },
  });
}

/** Lag por grupo, sumando todas las particiones de todos los topics. */
export async function lagGrupos(): Promise<LagGrupoView[]> {
  const admin = crearKafka().admin();
  await admin.connect();
  try {
    const topics = (await admin.listTopics()).filter((t) => !t.startsWith("__"));
    const altos = new Map<string, Map<number, number>>();

    await Promise.all(
      topics.map(async (topic) => {
        try {
          const offsets = await admin.fetchTopicOffsets(topic);
          altos.set(topic, new Map(offsets.map((o) => [o.partition, Number(o.high)])));
        } catch {
          // topic sin datos
        }
      }),
    );

    const resultado: LagGrupoView[] = [];
    for (const grupo of GRUPOS_MONITOREADOS) {
      let committed: Awaited<ReturnType<typeof admin.fetchOffsets>> = [];
      try {
        committed = await admin.fetchOffsets({ groupId: grupo });
      } catch {
        committed = [];
      }
      let total = 0;
      for (const t of committed) {
        for (const p of t.partitions) {
          const high = altos.get(t.topic)?.get(p.partition) ?? 0;
          const offset = Number(p.offset);
          total += Math.max(0, high - (Number.isFinite(offset) && offset >= 0 ? offset : 0));
        }
      }
      resultado.push({ grupo, total });
    }
    return resultado;
  } finally {
    await admin.disconnect().catch(() => undefined);
  }
}

/**
 * Borra los registros de todos los topics hasta el high watermark. Deja el log
 * vacio sin recrear los topics ni reiniciar el broker.
 */
export async function truncarTopics(): Promise<
  Array<{ topic: string; ok: boolean; error?: string }>
> {
  const admin = crearKafka().admin();
  await admin.connect();
  const resultado: Array<{ topic: string; ok: boolean; error?: string }> = [];
  try {
    const topics = (await admin.listTopics()).filter((t) => !t.startsWith("__"));
    for (const topic of topics) {
      try {
        const offsets = await admin.fetchTopicOffsets(topic);
        const partitions = offsets
          .filter((o) => Number(o.high) > 0)
          .map((o) => ({ partition: o.partition, offset: String(o.high) }));
        if (partitions.length === 0) {
          resultado.push({ topic, ok: true });
          continue;
        }
        await admin.deleteTopicRecords({ topic, partitions });
        resultado.push({ topic, ok: true });
      } catch (error) {
        resultado.push({ topic, ok: false, error: (error as Error).message });
      }
    }
    return resultado;
  } finally {
    await admin.disconnect().catch(() => undefined);
  }
}
