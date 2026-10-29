import {
  COL,
  ConsumerService,
  EventProducer,
  GRUPOS,
  TOPICS,
  asegurarTopics,
  cerrarDb,
  conectarDb,
  crearIndices,
  createKafka,
  createLogger,
  iniciarControl,
  numEnv,
} from "@rutasur/shared";
import { SlaMonitor } from "./monitor";

const logger = createLogger("monitor-sla");

async function main(): Promise<void> {
  const db = await conectarDb();
  await crearIndices(db);

  const kafka = createKafka("rutasur-monitor-sla");
  await asegurarTopics(kafka);
  const producer = new EventProducer(kafka);
  await producer.connect();

  const monitor = new SlaMonitor(db, producer, logger);
  await monitor.init();

  const servicio = new ConsumerService(kafka, {
    servicio: "monitor-sla",
    groupId: GRUPOS.monitorSla,
    topics: [TOPICS.estados, TOPICS.promesas],
    handler: async (payload, meta) => monitor.procesar(payload, meta.topic),
    db,
    producer,
    logger,
    onBeforeRebuild: async () => {
      await monitor.limpiar();
      await db.collection(COL.procesados).deleteMany({ consumidor: GRUPOS.monitorSla });
    },
  });

  await servicio.start();

  const server = iniciarControl(
    "monitor-sla",
    numEnv("SLA_MONITOR_PORT", 4005),
    [
      {
        method: "GET",
        path: "/stats",
        handler: async () => ({ body: { seguimientos: monitor.seguimientos } }),
      },
      {
        method: "POST",
        path: "/rebuild",
        handler: async () => {
          await servicio.rebuild();
          return { body: { ok: true, detalle: "monitor de SLA reprocesando desde el inicio" } };
        },
      },
    ],
    logger,
  );

  const cerrar = async (): Promise<void> => {
    server.close();
    await servicio.stop();
    await monitor.stop();
    await producer.disconnect();
    await cerrarDb();
    process.exit(0);
  };
  process.on("SIGINT", () => void cerrar());
  process.on("SIGTERM", () => void cerrar());
}

main().catch((error) => {
  logger.error({ error: (error as Error).stack }, "no se pudo iniciar el monitor de SLA");
  process.exit(1);
});
