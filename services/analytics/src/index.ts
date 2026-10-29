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
import { MetricasService } from "./metricas";
import { ReplayService } from "./replay";

const logger = createLogger("analitica");

async function main(): Promise<void> {
  const db = await conectarDb();
  await crearIndices(db);

  const kafka = createKafka("rutasur-analitica");
  await asegurarTopics(kafka);
  const producer = new EventProducer(kafka);
  await producer.connect();

  const metricas = new MetricasService(db, logger);
  await metricas.preloadPromesas(kafka);
  const replay = new ReplayService(kafka, db, producer, logger);

  const servicio = new ConsumerService(kafka, {
    servicio: "analitica",
    groupId: GRUPOS.analitica,
    topics: [TOPICS.estados, TOPICS.promesas],
    transactional: true,
    handler: async (payload, meta, _ctx, session) =>
      metricas.procesar(payload, meta.topic, session),
    db,
    producer,
    logger,
    onBeforeRebuild: async () => {
      await replay.limpiar();
      await Promise.all([
        db.collection(COL.metricas).deleteMany({}),
        db.collection(COL.procesados).deleteMany({ consumidor: GRUPOS.analitica }),
      ]);
    },
  });

  await servicio.start();

  const server = iniciarControl(
    "analitica",
    numEnv("ANALYTICS_PORT", 4001),
    [
      {
        method: "GET",
        path: "/stats",
        handler: async () => ({
          body: {
            metricas: await db.collection(COL.metricas).countDocuments({}),
            tiemposHub: await db.collection(COL.tiemposHub).countDocuments({}),
            replay: replay.status,
          },
        }),
      },
      {
        method: "GET",
        path: "/replay",
        handler: async () => ({ body: replay.status }),
      },
      {
        method: "POST",
        path: "/replay",
        handler: async () => ({ body: await replay.iniciar() }),
      },
      {
        method: "POST",
        path: "/replay/stop",
        handler: async () => {
          await replay.detener();
          return { body: replay.status };
        },
      },
      {
        method: "POST",
        path: "/rebuild",
        handler: async () => {
          await servicio.rebuild();
          return { body: { ok: true, detalle: "analitica reprocesando desde el inicio" } };
        },
      },
    ],
    logger,
  );

  const cerrar = async (): Promise<void> => {
    server.close();
    await replay.detener();
    await servicio.stop();
    await producer.disconnect();
    await cerrarDb();
    process.exit(0);
  };
  process.on("SIGINT", () => void cerrar());
  process.on("SIGTERM", () => void cerrar());
}

main().catch((error) => {
  logger.error({ error: (error as Error).stack }, "no se pudo iniciar analitica");
  process.exit(1);
});
