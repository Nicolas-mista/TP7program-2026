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
  type HandlerContext,
  type EventMeta,
} from "@rutasur/shared";
import { handleAlerta, handleEstado } from "./handlers";

const logger = createLogger("notificaciones");

async function main(): Promise<void> {
  const db = await conectarDb();
  await crearIndices(db);

  const kafka = createKafka("rutasur-notificaciones");
  await asegurarTopics(kafka);
  const producer = new EventProducer(kafka);
  await producer.connect();

  const despachar = async (payload: any, meta: EventMeta, ctx: HandlerContext): Promise<void> => {
    if (meta.topic === TOPICS.estados) return handleEstado(payload, meta, ctx);
    if (meta.topic === TOPICS.alertas) return handleAlerta(payload, meta, ctx);
  };

  const servicio = new ConsumerService(kafka, {
    servicio: "notificaciones",
    groupId: GRUPOS.notificaciones,
    topics: [TOPICS.estados, TOPICS.alertas],
    handler: despachar,
    db,
    producer,
    logger,
    onBeforeRebuild: async () => {
      await db
        .collection(COL.procesados)
        .deleteMany({ consumidor: GRUPOS.notificaciones });
    },
  });

  await servicio.start();

  const server = iniciarControl(
    "notificaciones",
    numEnv("NOTIFICATIONS_PORT", 4003),
    [
      {
        method: "POST",
        path: "/rebuild",
        handler: async () => {
          await servicio.rebuild();
          return { body: { ok: true, detalle: "notificaciones reprocesando desde el inicio" } };
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
  logger.error({ error: (error as Error).stack }, "no se pudo iniciar notificaciones");
  process.exit(1);
});
