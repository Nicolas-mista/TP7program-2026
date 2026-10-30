import { ConfigResourceTypes, Kafka } from "kafkajs";
import type { LagGrupoView } from "./types";

/** Topics compactados: Kafka no permite deleteRecords hasta pasar a delete. */
const TOPICS_COMPACTADOS = new Set(["envios.promesas"]);

async function cambiarCleanup(
  admin: ReturnType<Kafka["admin"]>,
  topic: string,
  policy: "compact" | "delete",
): Promise<void> {
  await admin.alterConfigs({
    validateOnly: false,
    resources: [
      {
        type: ConfigResourceTypes.TOPIC,
        name: topic,
        configEntries: [
          { name: "cleanup.policy", value: policy },
          { name: "retention.ms", value: "-1" },
        ],
      },
    ],
  });
}

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
      const compactado = TOPICS_COMPACTADOS.has(topic);
      let ultimoError: unknown;
      let truncado = false;

      // deleteRecords no esta permitido en topics compactados: pasamos la
      // politica a delete mientras dura el truncado y la restauramos despues.
      if (compactado) {
        try {
          await cambiarCleanup(admin, topic, "delete");
        } catch (error) {
          resultado.push({ topic, ok: false, error: (error as Error).message });
          continue;
        }
      }

      try {
        // deleteRecords falla si entra un mensaje entre el fetch del high
        // watermark y el borrado. El simulador ya esta pausado, pero puede
        // quedar un envio en vuelo: reintentamos con el high actualizado.
        for (let intento = 0; intento < 3 && !truncado; intento += 1) {
          try {
            const offsets = await admin.fetchTopicOffsets(topic);
            const partitions = offsets
              .filter((o) => Number(o.high) > 0)
              .map((o) => ({ partition: o.partition, offset: String(o.high) }));
            if (partitions.length === 0) {
              truncado = true;
              break;
            }
            await admin.deleteTopicRecords({ topic, partitions });
            truncado = true;
          } catch (error) {
            ultimoError = error;
            if (intento < 2) {
              await new Promise((r) => setTimeout(r, 300 * (intento + 1)));
            }
          }
        }
      } finally {
        if (compactado) {
          try {
            await cambiarCleanup(admin, topic, "compact");
          } catch (error) {
            truncado = false;
            ultimoError = error;
          }
        }
      }

      resultado.push(
        truncado
          ? { topic, ok: true }
          : { topic, ok: false, error: (ultimoError as Error)?.message ?? "error desconocido" },
      );
    }
    return resultado;
  } finally {
    await admin.disconnect().catch(() => undefined);
  }
}
