import type { Db } from "mongodb";
import { COL } from "./collections";

export async function asegurarColecciones(base: Db): Promise<void> {
  const existentes = new Set(
    (await base.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name),
  );
  for (const nombre of Object.values(COL)) {
    if (!existentes.has(nombre)) {
      try {
        await base.createCollection(nombre);
      } catch {
        // Otro proceso pudo crearla en paralelo.
      }
    }
  }
}

export async function crearIndices(base: Db): Promise<void> {
  await asegurarColecciones(base);

  await Promise.all([
    base.collection(COL.envios).createIndex({ estado: 1, zonaId: 1 }),
    base.collection(COL.envios).createIndex({ "promesa.venceEn": 1 }),
    base.collection(COL.envios).createIndex({ ultimoEventoEn: -1 }),

    base.collection(COL.alertas).createIndex({ estado: 1, prioridad: 1 }),
    base.collection(COL.alertas).createIndex({ shipmentId: 1 }),
    base
      .collection(COL.alertas)
      .createIndex({ shipmentId: 1, regla: 1 }, { unique: true, name: "alerta_por_regla" }),

    base.collection(COL.notificaciones).createIndex({ shipmentId: 1 }),
    base
      .collection(COL.notificaciones)
      .createIndex({ notificacionId: 1 }, { unique: true, name: "notificacion_unica" }),

    base.collection(COL.metricas).createIndex(
      { fecha: 1, zonaId: 1, hubId: 1, franja: 1 },
      { unique: true, name: "metrica_unica" },
    ),

    base.collection(COL.procesados).createIndex(
      { consumidor: 1, eventId: 1 },
      { unique: true, name: "procesado_unico" },
    ),
    base.collection(COL.procesados).createIndex(
      { procesadoEn: 1 },
      { expireAfterSeconds: 7 * 24 * 60 * 60, name: "procesados_ttl" },
    ),

    base.collection(COL.slaEstado).createIndex({ shipmentId: 1 }, { unique: true }),
    base.collection(COL.tiemposHub).createIndex({ hubId: 1, fecha: 1 }),
    base
      .collection(COL.tiemposHub)
      .createIndex({ shipmentId: 1 }, { unique: true, name: "tiempo_hub_unico" }),
    base
      .collection(COL.pendientes)
      .createIndex({ shipmentId: 1, intentoNuevo: 1 }, { unique: true }),
    base.collection(COL.pendientes).createIndex({ estado: 1, programadaPara: 1 }),
  ]);
}
