import type { Db } from "mongodb";
import { COLECCIONES } from "./colecciones";
import { porcentaje } from "./fechas";
import {
  ESTADOS,
  ORDEN_PRIORIDAD,
  type AlertaView,
  type AnaliticaData,
  type EnvioView,
  type NotificacionView,
  type ShipmentSnapshot,
  type TowerSnapshot,
  type TrackingSnapshot,
} from "./types";

const iso = (valor: any): string => (valor ? new Date(valor).toISOString() : "");
const isoNull = (valor: any): string | null => (valor ? new Date(valor).toISOString() : null);

/** Los envios usan el shipmentId como _id (string), no ObjectId. */
type DocEnvio = { _id: string } & Record<string, any>;
const envios = (db: Db) => db.collection<DocEnvio>(COLECCIONES.envios);

function aAlerta(doc: any): AlertaView {
  return {
    alertaId: doc.alertaId ?? doc._id,
    shipmentId: doc.shipmentId,
    regla: doc.regla,
    prioridad: doc.prioridad,
    causa: doc.causa,
    estado: doc.estado,
    venceEn: iso(doc.venceEn),
    abiertaEn: iso(doc.abiertaEn),
    cerradaEn: isoNull(doc.cerradaEn),
    zonaId: doc.zonaId ?? null,
    hubId: doc.hubId ?? null,
  };
}

function aNotificacion(doc: any): NotificacionView {
  return {
    notificacionId: doc.notificacionId ?? doc._id,
    shipmentId: doc.shipmentId,
    categoria: doc.categoria,
    canal: doc.canal,
    destinatario: doc.destinatario,
    mensaje: doc.mensaje,
    enviadaEn: iso(doc.enviadaEn),
  };
}

function aEnvio(doc: any): EnvioView {
  return {
    shipmentId: doc._id,
    estado: doc.estado,
    estadoDesde: iso(doc.estadoDesde),
    intento: doc.intento ?? 1,
    hubId: doc.hubId ?? null,
    zonaId: doc.zonaId ?? null,
    repartidorId: doc.repartidorId ?? null,
    promesa: doc.promesa
      ? {
          venceEn: iso(doc.promesa.venceEn),
          franja: doc.promesa.franja,
          compromiso: doc.promesa.compromiso,
        }
      : null,
    historial: (doc.historial ?? []).map((h: any) => ({
      eventId: h.eventId,
      tipo: h.tipo,
      ocurridoEn: iso(h.ocurridoEn),
      secuencia: h.secuencia,
      intento: h.intento ?? 1,
      motivo: h.motivo,
    })),
    reprogramaciones: (doc.reprogramaciones ?? []).map((r: any) => ({
      eventId: r.eventId,
      intento: r.intento,
      decision: r.decision,
      motivo: r.motivo,
      fechaProgramada: isoNull(r.fechaProgramada),
      franja: r.franja ?? null,
      detalle: r.detalle,
      ocurridoEn: iso(r.ocurridoEn),
    })),
    proximoIntento: doc.proximoIntento
      ? {
          fechaProgramada: iso(doc.proximoIntento.fechaProgramada),
          franja: doc.proximoIntento.franja,
          intento: doc.proximoIntento.intento,
        }
      : null,
    devolucion: Boolean(doc.devolucion),
    retenido: Boolean(doc.retenido),
    ultimoMotivo: doc.ultimoMotivo,
    ultimoEventoEn: iso(doc.ultimoEventoEn),
    actualizadoEn: iso(doc.actualizadoEn),
  };
}

export async function getTowerSnapshot(db: Db): Promise<TowerSnapshot> {
  const [porEstado, alertasDocs, recientesDocs] = await Promise.all([
    db
      .collection(COLECCIONES.envios)
      .aggregate([{ $group: { _id: "$estado", total: { $sum: 1 } } }])
      .toArray(),
    db
      .collection(COLECCIONES.alertas)
      .find({ estado: "ABIERTA" })
      .sort({ abiertaEn: -1 })
      .limit(40)
      .toArray(),
    envios(db)
      .find(
        {},
        {
          projection: {
            shipmentId: 1,
            estado: 1,
            ultimoEventoEn: 1,
            zonaId: 1,
            intento: 1,
            historial: { $slice: -1 },
          },
        },
      )
      .sort({ ultimoEventoEn: -1 })
      .limit(12)
      .toArray(),
  ]);

  const counts: Record<string, number> = {};
  for (const estado of ESTADOS) counts[estado] = 0;
  for (const fila of porEstado) counts[String(fila._id)] = fila.total;

  const alertas = alertasDocs
    .map(aAlerta)
    .sort(
      (a, b) =>
        ORDEN_PRIORIDAD[a.prioridad] - ORDEN_PRIORIDAD[b.prioridad] ||
        b.abiertaEn.localeCompare(a.abiertaEn),
    );

  const recientes = recientesDocs.map((d: any) => ({
    shipmentId: d._id ?? d.shipmentId,
    estado: d.estado,
    ultimoEventoEn: iso(d.ultimoEventoEn),
    zonaId: d.zonaId ?? null,
    intento: d.intento ?? 1,
    ultimoTipo: d.historial?.[0]?.tipo ?? d.estado,
  }));

  return {
    counts,
    total: Object.values(counts).reduce((a, b) => a + b, 0),
    alertas,
    recientes,
    actualizadoEn: new Date().toISOString(),
  };
}

export async function getShipmentSnapshot(db: Db, shipmentId: string): Promise<ShipmentSnapshot> {
  const [envio, alertas, notificaciones] = await Promise.all([
    envios(db).findOne({ _id: shipmentId }),
    db
      .collection(COLECCIONES.alertas)
      .find({ shipmentId })
      .sort({ abiertaEn: -1 })
      .toArray(),
    db
      .collection(COLECCIONES.notificaciones)
      .find({ shipmentId })
      .sort({ enviadaEn: -1 })
      .toArray(),
  ]);

  return {
    envio: envio ? aEnvio(envio) : null,
    alertas: alertas.map(aAlerta),
    notificaciones: notificaciones.map(aNotificacion),
  };
}

export async function getTrackingSnapshot(
  db: Db,
  shipmentId: string,
): Promise<TrackingSnapshot | null> {
  const doc = await envios(db).findOne({ _id: shipmentId });
  if (!doc) return null;
  return {
    shipmentId: String(doc._id),
    estado: doc.estado,
    promesa: doc.promesa
      ? {
          venceEn: iso(doc.promesa.venceEn),
          franja: doc.promesa.franja,
          compromiso: doc.promesa.compromiso,
        }
      : null,
    historial: (doc.historial ?? []).map((h: any) => ({
      tipo: h.tipo,
      ocurridoEn: iso(h.ocurridoEn),
    })),
    actualizadoEn: iso(doc.actualizadoEn),
  };
}

export interface FiltrosAnalitica {
  zona?: string;
  hub?: string;
  desde?: string;
  hasta?: string;
}

const SUMS = {
  intentos: { $sum: "$intentos" },
  fallos: { $sum: "$fallos" },
  entregas: { $sum: "$entregas" },
  entregasPrimerIntento: { $sum: "$entregasPrimerIntento" },
  primerosIntentosFallidos: { $sum: "$primerosIntentosFallidos" },
  entregasEnFecha: { $sum: "$entregasEnFecha" },
  AUSENTE: { $sum: "$fallosPorMotivo.AUSENTE" },
  DIRECCION_INCORRECTA: { $sum: "$fallosPorMotivo.DIRECCION_INCORRECTA" },
  RECHAZADO: { $sum: "$fallosPorMotivo.RECHAZADO" },
  ZONA_INACCESIBLE: { $sum: "$fallosPorMotivo.ZONA_INACCESIBLE" },
};

export async function getAnalitica(db: Db, filtros: FiltrosAnalitica): Promise<AnaliticaData> {
  const match: Record<string, unknown> = {};
  if (filtros.zona) match.zonaId = filtros.zona;
  if (filtros.hub) match.hubId = filtros.hub;
  if (filtros.desde || filtros.hasta) {
    match.fecha = {
      ...(filtros.desde ? { $gte: filtros.desde } : {}),
      ...(filtros.hasta ? { $lte: filtros.hasta } : {}),
    };
  }

  const matchTiempos: Record<string, unknown> = {};
  if (filtros.hub) matchTiempos.hubId = filtros.hub;
  if (filtros.desde || filtros.hasta) {
    matchTiempos.fecha = {
      ...(filtros.desde ? { $gte: filtros.desde } : {}),
      ...(filtros.hasta ? { $lte: filtros.hasta } : {}),
    };
  }

  const [porZonaFranjaRaw, porZonaRaw, porHubRaw, tiemposRaw, zonas, hubs] = await Promise.all([
    db
      .collection(COLECCIONES.metricas)
      .aggregate([
        ...(Object.keys(match).length > 0 ? [{ $match: match }] : []),
        { $group: { _id: { zonaId: "$zonaId", franja: "$franja" }, ...SUMS } },
        { $sort: { "_id.zonaId": 1, "_id.franja": 1 } },
      ])
      .toArray(),
    db
      .collection(COLECCIONES.metricas)
      .aggregate([
        ...(Object.keys(match).length > 0 ? [{ $match: match }] : []),
        { $group: { _id: "$zonaId", ...SUMS } },
        { $sort: { _id: 1 } },
      ])
      .toArray(),
    db
      .collection(COLECCIONES.metricas)
      .aggregate([
        ...(Object.keys(match).length > 0 ? [{ $match: match }] : []),
        { $group: { _id: "$hubId", ...SUMS } },
        { $sort: { _id: 1 } },
      ])
      .toArray(),
    db
      .collection(COLECCIONES.tiemposHub)
      .aggregate([
        ...(Object.keys(matchTiempos).length > 0 ? [{ $match: matchTiempos }] : []),
        { $group: { _id: "$hubId", minutosPromedio: { $avg: "$minutos" }, muestras: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ])
      .toArray(),
    db.collection(COLECCIONES.metricas).distinct("zonaId"),
    db.collection(COLECCIONES.metricas).distinct("hubId"),
  ]);

  const porZonaFranja = porZonaFranjaRaw.map((r: any) => ({
    zonaId: r._id.zonaId,
    franja: r._id.franja,
    intentos: r.intentos,
    fallos: r.fallos,
    entregas: r.entregas,
    tasaPrimerIntento: porcentaje(
      r.entregasPrimerIntento,
      r.entregasPrimerIntento + r.primerosIntentosFallidos,
    ),
  }));

  const motivos = porZonaRaw.map((r: any) => ({
    zonaId: r._id,
    total: r.fallos,
    AUSENTE: r.AUSENTE,
    DIRECCION_INCORRECTA: r.DIRECCION_INCORRECTA,
    RECHAZADO: r.RECHAZADO,
    ZONA_INACCESIBLE: r.ZONA_INACCESIBLE,
  }));

  const slaPorHub = porHubRaw.map((r: any) => ({
    hubId: r._id,
    entregas: r.entregas,
    enFecha: r.entregasEnFecha,
    cumplimiento: porcentaje(r.entregasEnFecha, r.entregas),
  }));

  interface Totales {
    intentos: number;
    fallos: number;
    entregas: number;
    entregasPrimerIntento: number;
    primerosIntentosFallidos: number;
    entregasEnFecha: number;
  }

  const totales = porHubRaw.reduce<Totales>(
    (acc, r: any) => ({
      intentos: acc.intentos + r.intentos,
      fallos: acc.fallos + r.fallos,
      entregas: acc.entregas + r.entregas,
      entregasPrimerIntento: acc.entregasPrimerIntento + r.entregasPrimerIntento,
      primerosIntentosFallidos: acc.primerosIntentosFallidos + r.primerosIntentosFallidos,
      entregasEnFecha: acc.entregasEnFecha + r.entregasEnFecha,
    }),
    {
      intentos: 0,
      fallos: 0,
      entregas: 0,
      entregasPrimerIntento: 0,
      primerosIntentosFallidos: 0,
      entregasEnFecha: 0,
    },
  );

  return {
    global: {
      ...totales,
      tasaPrimerIntento: porcentaje(
        totales.entregasPrimerIntento,
        totales.entregasPrimerIntento + totales.primerosIntentosFallidos,
      ),
      cumplimientoSla: porcentaje(totales.entregasEnFecha, totales.entregas),
    },
    porZonaFranja,
    motivos,
    slaPorHub,
    tiemposHub: tiemposRaw.map((r: any) => ({
      hubId: r._id,
      minutosPromedio: Math.round(r.minutosPromedio * 10) / 10,
      muestras: r.muestras,
    })),
    filtros: {
      zonas: (zonas as string[]).sort(),
      hubs: (hubs as string[]).sort(),
    },
  };
}
