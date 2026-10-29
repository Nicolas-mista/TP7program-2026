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
import { handleEstado } from "./handlers";

const logger = createLogger("reprogramacion");

async function main(): Promise<void> {
  const db = await conectarDb();
  await crearIndices(db);

  const kafka = createKafka("rutasur-reprogramacion");
  await asegurarTopics(kafka);
  const producer = new EventProducer(kafka);
  await producer.connect();

  const servicio = new ConsumerService(kafka, {
    servicio: "reprogramacion",
    groupId: GRUPOS.reprogramacion,
    topics: [TOPICS.estados],
    handler: handleEstado,
    db,
    producer,
    logger,
    onBeforeRebuild: async () => {
      await Promise.all([
        db.collection(COL.procesados).deleteMany({ consumidor: GRUPOS.reprogramacion }),
        db.collection(COL.pendientes).deleteMany({}),
      ]);
    },
  });

  await servicio.start();

  const server = iniciarControl(
    "reprogramacion",
    numEnv("RESCHEDULER_PORT", 4004),
    [
      {
        method: "POST",
        path: "/rebuild",
        handler: async () => {
          await servicio.rebuild();
          return { body: { ok: true, detalle: "reprogramacion reprocesando desde el inicio" } };
        },
      },
    ],
    logger,
  );

  const cerrar = async (): Promise<void> => {
    server.close();
    await servicio.stop();
    await producer.disconnect();
    await cerrarDb();
    process.exit(0);
  };
  process.on("SIGINT", () => void cerrar());
  process.on("SIGTERM", () => void cerrar());
}

main().catch((error) => {
  logger.error({ error: (error as Error).stack }, "no se pudo iniciar reprogramacion");
  process.exit(1);
});
