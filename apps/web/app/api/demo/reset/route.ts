import {
  ANALYTICS_URL,
  MONITOR_URL,
  NOTIFICATIONS_URL,
  PROJECTOR_URL,
  RESCHEDULER_URL,
  SIMULATOR_URL,
} from "@/lib/config";
import { lagGrupos, truncarTopics } from "@/lib/kafka-admin";
import { postJson } from "@/lib/servicios";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

const CONSUMIDORES = [
  { nombre: "proyector", url: `${PROJECTOR_URL}/rebuild` },
  { nombre: "notificaciones", url: `${NOTIFICATIONS_URL}/rebuild` },
  { nombre: "reprogramacion", url: `${RESCHEDULER_URL}/rebuild` },
  { nombre: "monitor-sla", url: `${MONITOR_URL}/rebuild` },
  { nombre: "analitica", url: `${ANALYTICS_URL}/rebuild` },
];

interface Paso {
  paso: string;
  ok: boolean;
  detalle?: string;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Espera a que los grupos principales drenen lo que ya tienen asignado. Asi el
 * truncado no deja mensajes en vuelo que reaparezcan despues del rebuild.
 */
async function esperarDrenaje(timeoutMs: number): Promise<boolean> {
  const nombres = new Set(CONSUMIDORES.map((c) => c.nombre));
  const inicio = Date.now();
  while (Date.now() - inicio < timeoutMs) {
    const grupos = await lagGrupos().catch(() => []);
    const pendientes = grupos
      .filter((g) => nombres.has(g.grupo))
      .reduce((total, g) => total + g.total, 0);
    if (pendientes === 0) return true;
    await sleep(500);
  }
  return false;
}

/**
 * Reset de demo sin recrear contenedores:
 *  1. pausa el simulador,
 *  2. vacia los topics (deleteRecords hasta el high watermark),
 *  3. reconstruye cada consumidor desde el inicio (grupo nuevo + colecciones),
 *  4. reinicia el reloj simulado y reanuda.
 */
export async function POST(): Promise<Response> {
  const pasos: Paso[] = [];

  const pausa = await postJson(`${SIMULATOR_URL}/control`, { pausado: true });
  pasos.push({ paso: "pausar simulador", ok: pausa.ok, detalle: pausa.error });

  // El replay tambien lee envios.estados; se detiene antes de truncar.
  const replay = await postJson(`${ANALYTICS_URL}/replay/stop`, {});
  pasos.push({ paso: "detener replay", ok: replay.ok, detalle: replay.error });

  const drenado = await esperarDrenaje(15_000);
  pasos.push({
    paso: "drenar consumidores",
    ok: drenado,
    detalle: drenado ? "lag en cero" : "quedaron mensajes pendientes",
  });

  const truncado = await truncarTopics().catch((error) => [
    { topic: "*", ok: false, error: (error as Error).message },
  ]);
  const fallidos = truncado.filter((t) => !t.ok);
  pasos.push({
    paso: "vaciar topics",
    ok: fallidos.length === 0,
    detalle:
      fallidos.length === 0
        ? `${truncado.length} topics vaciados`
        : `fallaron: ${fallidos.map((f) => f.topic).join(", ")}`,
  });

  const rebuilds = await Promise.all(
    CONSUMIDORES.map(async (c) => {
      const r = await postJson(c.url, {}, 60_000);
      return { paso: `rebuild ${c.nombre}`, ok: r.ok, detalle: r.error };
    }),
  );
  pasos.push(...rebuilds);

  const reset = await postJson(`${SIMULATOR_URL}/reset`, {});
  pasos.push({ paso: "reiniciar reloj simulado", ok: reset.ok, detalle: reset.error });

  const reanudar = await postJson(`${SIMULATOR_URL}/control`, { pausado: false });
  pasos.push({ paso: "reanudar simulador", ok: reanudar.ok, detalle: reanudar.error });

  const ok = pasos.every((p) => p.ok);
  return Response.json({ ok, pasos, detalle: ok ? "demo reiniciada" : "reset con advertencias" });
}
