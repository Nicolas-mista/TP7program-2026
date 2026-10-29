export const TOPICS = {
  estados: "envios.estados",
  promesas: "envios.promesas",
  reprogramaciones: "envios.reprogramaciones",
  alertas: "alertas.sla",
  notificaciones: "notificaciones.enviadas",
  dlq: "envios.estados.dlq",
} as const;

export type TopicName = (typeof TOPICS)[keyof typeof TOPICS];

export interface TopicSpec {
  topic: TopicName;
  partitions: number;
  /** -1 = retencion infinita (compactado) */
  retentionMs: number;
  cleanupPolicy: "delete" | "compact";
  descripcion: string;
}

const DIA = 24 * 60 * 60 * 1000;

export const TOPIC_SPECS: TopicSpec[] = [
  {
    topic: TOPICS.estados,
    partitions: 3,
    retentionMs: 30 * DIA,
    cleanupPolicy: "delete",
    descripcion: "Ciclo de vida de los envios",
  },
  {
    topic: TOPICS.promesas,
    partitions: 3,
    retentionMs: -1,
    cleanupPolicy: "compact",
    descripcion: "Promesa de entrega por envio (ultima version por clave)",
  },
  {
    topic: TOPICS.reprogramaciones,
    partitions: 1,
    retentionMs: 30 * DIA,
    cleanupPolicy: "delete",
    descripcion: "Decisiones del servicio de reprogramacion",
  },
  {
    topic: TOPICS.alertas,
    partitions: 1,
    retentionMs: 7 * DIA,
    cleanupPolicy: "delete",
    descripcion: "Alertas de riesgo de SLA",
  },
  {
    topic: TOPICS.notificaciones,
    partitions: 1,
    retentionMs: 7 * DIA,
    cleanupPolicy: "delete",
    descripcion: "Notificaciones simuladas al destinatario",
  },
  {
    topic: TOPICS.dlq,
    partitions: 1,
    retentionMs: 30 * DIA,
    cleanupPolicy: "delete",
    descripcion: "Eventos invalidos o con error de procesamiento",
  },
];

/** Grupos de consumidores de la plataforma. */
export const GRUPOS = {
  proyector: "proyector",
  notificaciones: "notificaciones",
  reprogramacion: "reprogramacion",
  monitorSla: "monitor-sla",
  analitica: "analitica",
  analiticaPromesas: "analitica-promesas",
  analiticaReplay: "analitica-replay",
  simuladorReintentos: "simulador-reintentos",
} as const;
