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
import { handleEstado } from "./handlers/estado";
import { handlePromesa } from "./handlers/promesa";
import { handleReprogramacion } from "./handlers/reprogramacion";
import { handleAlerta } from "./handlers/alerta";
import { handleNotificacion } from "./handlers/notificacion";

const logger = createLogger("proyector");

async function main(): Promise<void> {
  const db = await conectarDb();
  await crearIndices(db);

  const kafka = createKafka("rutasur-proyector");
  await asegurarTopics(kafka);
  const producer = new EventProducer(kafka);
  await producer.connect();

  const despachar = async (payload: any, meta: EventMeta, ctx: HandlerContext): Promise<void> => {
    switch (meta.topic) {
      case TOPICS.estados:
        return handleEstado(payload, meta, ctx);
      case TOPICS.promesas:
        return handlePromesa(payload, meta, ctx);
      case TOPICS.reprogramaciones:
        return handleReprogramacion(payload, meta, ctx);
      case TOPICS.alertas:
        return handleAlerta(payload, meta, ctx);
      case TOPICS.notificaciones:
        return handleNotificacion(payload, meta, ctx);
      default:
        ctx.logger.warn({ topic: meta.topic }, "topic sin handler en el proyector");
    }
  };

  const servicio = new ConsumerService(kafka, {
    servicio: "proyector",
    groupId: GRUPOS.proyector,
    topics: [
      TOPICS.estados,
      TOPICS.promesas,
      TOPICS.reprogramaciones,
      TOPICS.alertas,
      TOPICS.notificaciones,
    ],
    handler: despachar,
    db,
    producer,
    logger,
    onBeforeRebuild: async () => {
      await Promise.all([
        db.collection(COL.envios).deleteMany({}),
        db.collection(COL.alertas).deleteMany({}),
        db.collection(COL.notificaciones).deleteMany({}),
        db.collection(COL.procesados).deleteMany({ consumidor: GRUPOS.proyector }),
      ]);
      logger.info("rebuild: vistas del proyector borradas");
    },
  });

  await servicio.start();

  const server = iniciarControl(
    "proyector",
    numEnv("PROJECTOR_PORT", 4002),
    [
      {
        method: "GET",
        path: "/stats",
        handler: async () => {
          const [porEstado, alertas, notificaciones] = await Promise.all([
            db
              .collection(COL.envios)
              .aggregate([{ $group: { _id: "$estado", total: { $sum: 1 } } }])
              .toArray(),
            db.collection(COL.alertas).countDocuments({ estado: "ABIERTA" }),
            db.collection(COL.notificaciones).countDocuments({}),
          ]);
          return {
            body: {
              envios: Object.fromEntries(porEstado.map((e) => [e._id, e.total])),
              alertasAbiertas: alertas,
              notificaciones,
            },
          };
        },
      },
      {
        method: "POST",
        path: "/rebuild",
        handler: async () => {
          await servicio.rebuild();
          return { body: { ok: true, detalle: "proyector reprocesando desde el inicio" } };
        },
      },
    ],
    logger,
  );

  const cerrar = async (): Promise<void> => {
    logger.info("deteniendo proyector");
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
  logger.error({ error: (error as Error).stack }, "no se pudo iniciar el proyector");
  process.exit(1);
});
