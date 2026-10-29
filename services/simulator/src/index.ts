import {
  EventProducer,
  cerrarDb,
  conectarDb,
  crearIndices,
  createKafka,
  createLogger,
  getSimRate,
  getSimSeed,
  getSimSpeed,
  iniciarControl,
  numEnv,
  asegurarTopics,
} from "@rutasur/shared";
import { SimulatorEngine } from "./engine";

const logger = createLogger("simulador");
const kafka = createKafka("rutasur-simulador");
const producer = new EventProducer(kafka);

async function main(): Promise<void> {
  const db = await conectarDb();
  await crearIndices(db);
  await asegurarTopics(kafka);
  await producer.connect();

  const engine = new SimulatorEngine(
    db,
    producer,
    logger,
    getSimSpeed(),
    getSimRate(),
    getSimSeed(),
  );
  await engine.start();

  const puerto = numEnv("SIMULATOR_PORT", 4000);
  const server = iniciarControl(
    "simulador",
    puerto,
    [
      {
        method: "GET",
        path: "/status",
        handler: async () => ({ body: engine.status() }),
      },
      {
        method: "POST",
        path: "/scenario",
        handler: async (body) => {
          const nombre = String(body?.nombre ?? "");
          return { body: await engine.escenario(nombre) };
        },
      },
      {
        method: "POST",
        path: "/inject",
        handler: async (body) => {
          const tipo = String(body?.tipo ?? "");
          return { body: await engine.inyectar(tipo) };
        },
      },
      {
        method: "POST",
        path: "/control",
        handler: async (body) => ({
          body: await engine.control(body ?? {}),
        }),
      },
      {
        method: "POST",
        path: "/reset",
        handler: async () => {
          await engine.reset();
          return { body: { ok: true, estado: engine.status() } };
        },
      },
    ],
    logger,
  );

  const cerrar = async (): Promise<void> => {
    logger.info("deteniendo simulador");
    server.close();
    await engine.stop();
    await producer.disconnect();
    await cerrarDb();
    process.exit(0);
  };

  process.on("SIGINT", () => void cerrar());
  process.on("SIGTERM", () => void cerrar());
  process.on("unhandledRejection", (error) => {
    logger.error({ error: String(error) }, "unhandled rejection");
  });
}

main().catch((error) => {
  logger.error({ error: (error as Error).stack }, "no se pudo iniciar el simulador");
  process.exit(1);
});
