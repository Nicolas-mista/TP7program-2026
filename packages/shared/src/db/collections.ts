import type { ObjectId } from "mongodb";
import type {
  Decision,
  EstadoTipo,
  Franja,
  MotivoFallo,
  Prioridad,
  ReglaSla,
} from "../events/types";

export const COL = {
  envios: "envios",
  alertas: "alertas",
  notificaciones: "notificaciones",
  metricas: "metricas_diarias",
  procesados: "eventos_procesados",
  slaEstado: "sla_estado",
  tiemposHub: "tiempos_hub",
  simState: "sim_state",
  pendientes: "reprogramaciones_pendientes",
} as const;

export interface EntradaHistorial {
  eventId: string;
  tipo: EstadoTipo;
  ocurridoEn: Date;
  secuencia: number;
  intento: number;
  motivo?: MotivoFallo;
}

export interface DocumentoEnvio {
  _id: string;
  shipmentId: string;
  estado: EstadoTipo;
  estadoDesde: Date;
  intento: number;
  hubId: string | null;
  zonaId: string | null;
  repartidorId: string | null;
  promesa?: { venceEn: Date; franja: Franja; compromiso: string };
  historial: EntradaHistorial[];
  ultimaSecuencia: number;
  ultimoEventoEn: Date;
  reprogramaciones: Array<{
    eventId: string;
    intento: number;
    decision: Decision;
    motivo: MotivoFallo;
    fechaProgramada: Date | null;
    franja: Franja | null;
    detalle: string;
    ocurridoEn: Date;
  }>;
  proximoIntento?: { fechaProgramada: Date; franja: Franja; intento: number };
  devolucion?: boolean;
  retenido?: boolean;
  actualizadoEn: Date;
}

export interface DocumentoAlerta {
  _id: string;
  alertaId: string;
  shipmentId: string;
  regla: ReglaSla;
  prioridad: Prioridad;
  causa: string;
  estado: "ABIERTA" | "CERRADA";
  venceEn: Date;
  abiertaEn: Date;
  cerradaEn?: Date;
  hubId?: string | null;
  zonaId?: string | null;
  intento?: number;
  actualizadoEn: Date;
}

export interface DocumentoNotificacion {
  _id: string;
  notificacionId: string;
  shipmentId: string;
  categoria: "FALLO" | "REPROGRAMACION" | "ALERTA_SLA";
  canal: "SMS" | "EMAIL" | "INTERNO";
  destinatario: string;
  mensaje: string;
  enviadaEn: Date;
  origenEventId: string;
}

export interface DocumentoMetrica {
  _id?: ObjectId;
  fecha: string;
  zonaId: string;
  hubId: string;
  franja: Franja;
  intentos: number;
  fallos: number;
  entregas: number;
  entregasPrimerIntento: number;
  primerosIntentosFallidos: number;
  entregasEnFecha: number;
  fallosPorMotivo: Partial<Record<MotivoFallo, number>>;
  actualizadoEn: Date;
}

export interface DocumentoProcesado {
  _id?: ObjectId;
  consumidor: string;
  eventId: string;
  topic: string;
  partition: number;
  offset: string;
  procesadoEn: Date;
}

export interface DocumentoSlaEstado {
  _id: string;
  shipmentId: string;
  estado: EstadoTipo;
  venceEn: Date | null;
  intento: number;
  hubId: string | null;
  zonaId: string | null;
  ultimaSecuencia: number;
  reglasDisparadas: ReglaSla[];
  alertasAbiertas: Array<{ regla: ReglaSla; alertaId: string }>;
  actualizadoEn: Date;
}

export interface DocumentoTiempoHub {
  _id?: ObjectId;
  shipmentId: string;
  hubId: string;
  fecha: string;
  ingresadoEn: Date;
  enRepartoEn: Date;
  minutos: number;
  actualizadoEn: Date;
}

export interface DocumentoPendiente {
  _id: string;
  shipmentId: string;
  intentoOrigen: number;
  intentoNuevo: number;
  decision: Decision;
  motivo: MotivoFallo;
  programadaPara: Date;
  franja: Franja | null;
  estado: "PENDIENTE" | "EMITIDA" | "COMPLETADA" | "CANCELADA";
  ultimaSecuencia: number;
  hubId: string | null;
  zonaId: string | null;
  repartidorId: string | null;
  resultadoEn?: Date;
  resultadoForzado?: "ENTREGADO" | "ENTREGA_FALLIDA" | null;
  resultadoMotivo?: MotivoFallo | null;
  actualizadoEn: Date;
}
