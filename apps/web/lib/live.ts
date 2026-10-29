import { COLECCIONES } from "./colecciones";
import { getDb } from "./mongo";
import { getShipmentSnapshot, getTowerSnapshot, getTrackingSnapshot } from "./queries";
import type { Scope } from "./types";

interface Suscriptor {
  id: string;
  scope: Scope;
  shipmentId?: string;
  enviar: (data: unknown) => void;
}

interface Bus {
  subs: Map<string, Suscriptor>;
  streams: Array<{ close: () => Promise<void>; on: (event: string, cb: any) => void }>;
  iniciado: boolean;
  iniciando: Promise<void> | null;
  timer: NodeJS.Timeout | null;
  timerReintento: NodeJS.Timeout | null;
}

const g = globalThis as unknown as { __rutasurLive?: Bus };

function bus(): Bus {
  if (!g.__rutasurLive) {
    g.__rutasurLive = {
      subs: new Map(),
      streams: [],
      iniciado: false,
      iniciando: null,
      timer: null,
      timerReintento: null,
    };
  }
  return g.__rutasurLive;
}

export async function suscribir(s: Suscriptor): Promise<() => void> {
  const b = bus();
  b.subs.set(s.id, s);
  try {
    await iniciar(b);
  } catch (error) {
    console.error("[live] no se pudieron abrir los change streams:", (error as Error).message);
    reintentar(b);
  }
  return () => {
    b.subs.delete(s.id);
  };
}

async function iniciar(b: Bus): Promise<void> {
  if (b.iniciado) return;
  if (b.iniciando) return b.iniciando;

  b.iniciando = (async () => {
    const db = await getDb();
    const streams: Bus["streams"] = [];
    try {
      for (const nombre of [COLECCIONES.envios, COLECCIONES.alertas, COLECCIONES.notificaciones]) {
        const stream = db.collection(nombre).watch([], { fullDocument: "updateLookup" });
        stream.on("change", () => programar(b));
        stream.on("error", (error: Error) => {
          console.error(`[live] change stream ${nombre}:`, error.message);
          void reiniciar(b);
        });
        streams.push(stream as unknown as Bus["streams"][number]);
      }
    } catch (error) {
      for (const stream of streams) await stream.close().catch(() => undefined);
      throw error;
    }
    b.streams = streams;
    b.iniciado = true;
    console.log("[live] change streams conectados");
  })();

  try {
    await b.iniciando;
  } finally {
    b.iniciando = null;
  }
}

async function reiniciar(b: Bus): Promise<void> {
  if (!b.iniciado) return;
  b.iniciado = false;
  for (const stream of b.streams) {
    try {
      await stream.close();
    } catch {
      // ignorar
    }
  }
  b.streams = [];
  if (b.subs.size === 0) return;
  reintentar(b);
}

/**
 * Reintenta abrir los change streams mientras haya suscriptores. Si Mongo
 * todavia no esta listo (por ejemplo al arrancar en modo dev), la interfaz
 * se recupera sola sin recargar la pagina.
 */
function reintentar(b: Bus): void {
  if (b.subs.size === 0 || b.timerReintento) return;
  b.timerReintento = setTimeout(() => {
    b.timerReintento = null;
    void iniciar(b).catch(() => reintentar(b));
  }, 3_000);
}

function programar(b: Bus): void {
  if (b.timer) return;
  b.timer = setTimeout(() => {
    b.timer = null;
    void flush(b);
  }, 350);
}

async function flush(b: Bus): Promise<void> {
  if (b.subs.size === 0) return;
  const db = await getDb().catch(() => null);
  if (!db) return;

  const torre = [...b.subs.values()].filter((s) => s.scope === "tower");
  if (torre.length > 0) {
    try {
      const snapshot = await getTowerSnapshot(db);
      for (const s of torre) s.enviar(snapshot);
    } catch (error) {
      console.error("[live] torre:", (error as Error).message);
    }
  }

  const porEnvio = new Map<string, Suscriptor[]>();
  const porTracking = new Map<string, Suscriptor[]>();
  for (const s of b.subs.values()) {
    if (!s.shipmentId) continue;
    const mapa = s.scope === "shipment" ? porEnvio : s.scope === "tracking" ? porTracking : null;
    if (!mapa) continue;
    const lista = mapa.get(s.shipmentId) ?? [];
    lista.push(s);
    mapa.set(s.shipmentId, lista);
  }

  for (const [id, subs] of porEnvio) {
    try {
      const snapshot = await getShipmentSnapshot(db, id);
      for (const s of subs) s.enviar(snapshot);
    } catch (error) {
      console.error("[live] envio:", (error as Error).message);
    }
  }

  for (const [id, subs] of porTracking) {
    try {
      const snapshot = await getTrackingSnapshot(db, id);
      for (const s of subs) s.enviar(snapshot);
    } catch (error) {
      console.error("[live] tracking:", (error as Error).message);
    }
  }
}
