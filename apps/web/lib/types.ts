export type Scope = "tower" | "shipment" | "tracking";

export type Prioridad = "CRITICA" | "ALTA" | "MEDIA";

export const ORDEN_PRIORIDAD: Record<Prioridad, number> = {
  CRITICA: 0,
  ALTA: 1,
  MEDIA: 2,
};

export const ESTADOS = [
  "CREADO",
  "INGRESADO_HUB",
  "CLASIFICADO",
  "EN_REPARTO",
  "ENTREGADO",
  "ENTREGA_FALLIDA",
] as const;

export const MOTIVOS = [
  "AUSENTE",
  "DIRECCION_INCORRECTA",
  "RECHAZADO",
  "ZONA_INACCESIBLE",
] as const;

export interface HistorialView {
  eventId: string;
  tipo: string;
  ocurridoEn: string;
  secuencia: number;
  intento: number;
  motivo?: string;
}

export interface EnvioView {
  shipmentId: string;
  estado: string;
  estadoDesde: string;
  intento: number;
  hubId: string | null;
  zonaId: string | null;
  repartidorId: string | null;
  promesa: { venceEn: string; franja: string; compromiso: string } | null;
  historial: HistorialView[];
  reprogramaciones: Array<{
    eventId: string;
    intento: number;
    decision: string;
    motivo: string;
    fechaProgramada: string | null;
    franja: string | null;
    detalle: string;
    ocurridoEn: string;
  }>;
  proximoIntento?: { fechaProgramada: string; franja: string; intento: number } | null;
  devolucion?: boolean;
  retenido?: boolean;
  ultimoMotivo?: string;
  ultimoEventoEn: string;
  actualizadoEn: string;
}

export interface AlertaView {
  alertaId: string;
  shipmentId: string;
  regla: string;
  prioridad: Prioridad;
  causa: string;
  estado: "ABIERTA" | "CERRADA";
  venceEn: string;
  abiertaEn: string;
  cerradaEn?: string | null;
  zonaId?: string | null;
  hubId?: string | null;
}

export interface NotificacionView {
  notificacionId: string;
  shipmentId: string;
  categoria: string;
  canal: string;
  destinatario: string;
  mensaje: string;
  enviadaEn: string;
}

export interface RecienteView {
  shipmentId: string;
  estado: string;
  ultimoEventoEn: string;
  zonaId: string | null;
  intento: number;
  ultimoTipo: string;
}

export interface TowerSnapshot {
  counts: Record<string, number>;
  total: number;
  alertas: AlertaView[];
  recientes: RecienteView[];
  actualizadoEn: string;
}

export interface ShipmentSnapshot {
  envio: EnvioView | null;
  alertas: AlertaView[];
  notificaciones: NotificacionView[];
}

export interface TrackingSnapshot {
  shipmentId: string;
  estado: string;
  promesa: { venceEn: string; franja: string; compromiso: string } | null;
  historial: Array<{ tipo: string; ocurridoEn: string }>;
  actualizadoEn: string;
}

export interface AnaliticaData {
  global: {
    intentos: number;
    fallos: number;
    entregas: number;
    entregasPrimerIntento: number;
    primerosIntentosFallidos: number;
    entregasEnFecha: number;
    tasaPrimerIntento: number;
    cumplimientoSla: number;
  };
  porZonaFranja: Array<{
    zonaId: string;
    franja: string;
    intentos: number;
    fallos: number;
    entregas: number;
    tasaPrimerIntento: number;
  }>;
  motivos: Array<{
    zonaId: string;
    total: number;
    AUSENTE: number;
    DIRECCION_INCORRECTA: number;
    RECHAZADO: number;
    ZONA_INACCESIBLE: number;
  }>;
  slaPorHub: Array<{
    hubId: string;
    entregas: number;
    enFecha: number;
    cumplimiento: number;
  }>;
  tiemposHub: Array<{ hubId: string; minutosPromedio: number; muestras: number }>;
  filtros: { zonas: string[]; hubs: string[] };
}

export interface SimStatus {
  simNow: string;
  speed: number;
  rate: number;
  pausado: boolean;
  enviosActivos: number;
  pendientes: number;
  publicados: number;
  seed: number;
  horaInicio: string;
}

export interface LagGrupoView {
  grupo: string;
  total: number;
}

export interface DemoStatus {
  sim: SimStatus | null;
  lag: LagGrupoView[];
  proyector: {
    envios: Record<string, number>;
    alertasAbiertas: number;
    notificaciones: number;
  } | null;
  analitica: {
    metricas: number;
    tiemposHub: number;
    replay: { activo: boolean; procesados: number; enviosEnMemoria: number };
  } | null;
  ts: string;
}
