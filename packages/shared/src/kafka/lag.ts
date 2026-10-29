import type { Kafka } from "kafkajs";

export interface LagParticion {
  topic: string;
  partition: number;
  committed: number;
  high: number;
  lag: number;
}

export interface LagGrupo {
  grupo: string;
  total: number;
  particiones: LagParticion[];
}

/** Calcula el lag (mensajes pendientes) de cada grupo de consumidores. */
export async function calcularLag(kafka: Kafka, grupos: string[]): Promise<LagGrupo[]> {
  const admin = kafka.admin();
  await admin.connect();
  try {
    const topics = (await admin.listTopics()).filter((t) => !t.startsWith("__"));
    const altos = new Map<string, Map<number, number>>();
    await Promise.all(
      topics.map(async (topic) => {
        try {
          const offsets = await admin.fetchTopicOffsets(topic);
          const mapa = new Map<number, number>();
          for (const o of offsets) mapa.set(o.partition, Number(o.high));
          altos.set(topic, mapa);
        } catch {
          // topic sin mensajes o inexistente
        }
      }),
    );

    const resultado: LagGrupo[] = [];
    for (const grupo of grupos) {
      let committed: Awaited<ReturnType<typeof admin.fetchOffsets>> = [];
      try {
        committed = await admin.fetchOffsets({ groupId: grupo });
      } catch {
        committed = [];
      }
      const particiones: LagParticion[] = [];
      for (const t of committed) {
        for (const p of t.partitions) {
          const high = altos.get(t.topic)?.get(p.partition) ?? 0;
          const offset = Number(p.offset);
          const consumido = Number.isFinite(offset) && offset >= 0 ? offset : 0;
          particiones.push({
            topic: t.topic,
            partition: p.partition,
            committed: consumido,
            high,
            lag: Math.max(0, high - consumido),
          });
        }
      }
      resultado.push({
        grupo,
        total: particiones.reduce((acc, p) => acc + p.lag, 0),
        particiones,
      });
    }
    return resultado;
  } finally {
    await admin.disconnect();
  }
}
