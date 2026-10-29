export type EstadoTipo =
  | "CREADO"
  | "INGRESADO_HUB"
  | "CLASIFICADO"
  | "EN_REPARTO"
  | "ENTREGADO"
  | "ENTREGA_FALLIDA";

export const ESTADOS: EstadoTipo[] = [
  "CREADO",
  "INGRESADO_HUB",
  "CLASIFICADO",
  "EN_REPARTO",
  "ENTREGADO",
  "ENTREGA_FALLIDA",
];

export type MotivoFallo =
  | "AUSENTE"
  | "DIRECCION_INCORRECTA"
  | "RECHAZADO"
  | "ZONA_INACCESIBLE";

export const MOTIVOS: MotivoFallo[] = [
  "AUSENTE",
  "DIRECCION_INCORRECTA",
  "RECHAZADO",
  "ZONA_INACCESIBLE",
];

export type Franja = "MAÑANA" | "TARDE" | "NOCHE";

export type Prioridad = "CRITICA" | "ALTA" | "MEDIA";

export type ReglaSla =
  | "SIN_INGRESO"
  | "SIN_SALIDA"
  | "FALLO_EN_DIA_LIMITE"
  | "VENCIDO";

export type Decision = "REINTENTO" | "RETENIDO" | "DEVOLUCION";

export interface EventoBase {
  eventId: string;
  shipmentId: string;
  tipo: string;
  ocurridoEn: string;
  secuencia: number;
  version: number;
  hubId?: string | null;
  zonaId?: string | null;
  repartidorId?: string | null;
}

export interface EventoEstado extends EventoBase {
  tipo: EstadoTipo;
  intento: number;
  motivo?: MotivoFallo;
  /** Marca los eventos emitidos por el simulador al reconstruir un reintento. */
  reintento?: boolean;
}

export interface EventoPromesa extends EventoBase {
  tipo: "PROMESA";
  promesa: {
    venceEn: string;
    franja: Franja;
    compromiso: string;
  };
}

export interface EventoReprogramacion extends EventoBase {
  tipo: "REPROGRAMACION";
  intento: number;
  decision: Decision;
  motivo: MotivoFallo;
  fechaProgramada: string | null;
  franja: Franja | null;
  detalle: string;
  origenEventId: string;
}

export interface EventoAlertaSla extends EventoBase {
  tipo: "ALERTA_SLA";
  alertaId: string;
  regla: ReglaSla;
  prioridad: Prioridad;
  causa: string;
  estado: "ABIERTA" | "CERRADA";
  venceEn: string;
}

export interface EventoNotificacion extends EventoBase {
  tipo: "NOTIFICACION_ENVIADA";
  notificacionId: string;
  categoria: "FALLO" | "REPROGRAMACION" | "ALERTA_SLA";
  canal: "SMS" | "EMAIL" | "INTERNO";
  destinatario: string;
  mensaje: string;
  origenEventId: string;
}

export interface EventoDlq {
  eventId: string;
  tipo: "EVENTO_RECHAZADO";
  ocurridoEn: string;
  version: number;
  consumidor: string;
  topic: string;
  partition: number;
  offset: string;
  motivo: string;
  error: string;
  original: string;
}

export type Evento =
  | EventoEstado
  | EventoPromesa
  | EventoReprogramacion
  | EventoAlertaSla
  | EventoNotificacion;
