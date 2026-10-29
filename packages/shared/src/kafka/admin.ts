import type { Kafka } from "kafkajs";
import { TOPIC_SPECS } from "../topics";

/**
 * Crea los topics que falten. Es idempotente: si el topic ya existe (por
 * ejemplo porque lo creo kafka-init) no hace nada y no falla.
 */
export async function asegurarTopics(kafka: Kafka): Promise<void> {
  const admin = kafka.admin();
  await admin.connect();
  try {
    const existentes = new Set(await admin.listTopics());
    const faltantes = TOPIC_SPECS.filter((spec) => !existentes.has(spec.topic));
    if (faltantes.length === 0) return;

    await admin.createTopics({
      waitForLeaders: true,
      topics: faltantes.map((spec) => ({
        topic: spec.topic,
        numPartitions: spec.partitions,
        replicationFactor: 1,
        configEntries: [
          { name: "cleanup.policy", value: spec.cleanupPolicy },
          ...(spec.retentionMs >= 0
            ? [{ name: "retention.ms", value: String(spec.retentionMs) }]
            : []),
        ],
      })),
    });
  } finally {
    await admin.disconnect();
  }
}
