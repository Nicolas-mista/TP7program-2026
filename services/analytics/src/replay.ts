import type { Db } from "mongodb";
import type { Kafka } from "kafkajs";
import {
  COL,
  ConsumerService,
  GRUPOS,
  TOPICS,
  fechaTz,
  minutosEntre,
  type EventoEstado,
  type EventProducer,
  type Logger,
} from "@rutasur/shared";

export interface EstadoReplay {
  activo: boolean;
  procesados: number;
  enviosEnMemoria: number;
}

/**
 * Cuarto indicador: tiempo medio entre INGRESADO_HUB y EN_REPARTO por hub.
 * Un grupo de consumidores nuevo lee el topic desde el inicio y completa el
 * historico sin tocar a los demas servicios.
 */
export class ReplayService {
  private servicio: ConsumerService | null = null;
  private readonly ingresos = new Map<string, Date>();
  private procesados = 0;
  private watcher: NodeJS.Timeout | null = null;
  private iniciadoEn = 0;
  private chequeosEnCero = 0;
  private verificando = false;
  /**
   * High watermark por particion al iniciar. El replay termina cuando alcanza
   * ese punto, aunque el simulador siga publicando: si se comparara contra el
   * high watermark vivo, con trafico continuo nunca llegaria a cero.
   */
  private objetivos = new Map<number, number>();

  constructor(
    private readonly kafka: Kafka,
    private readonly db: Db,
    private readonly producer: EventProducer,
    private readonly logger: Logger,
  ) {}

  get status(): EstadoReplay {
    return {
      activo: this.servicio !== null,
      procesados: this.procesados,
      enviosEnMemoria: this.ingresos.size,
    };
  }

  async iniciar(): Promise<EstadoReplay> {
    if (this.servicio) return this.status;

    // Cada replay arranca de cero: borra el grupo y las muestras anteriores
    // para volver a leer el historico completo desde el inicio del topic.
    await this.limpiar();
    this.objetivos = await this.offsetsObjetivo();

    const servicio = new ConsumerService(this.kafka, {
      servicio: "analitica-replay",
      groupId: GRUPOS.analiticaReplay,
      topics: [TOPICS.estados],
      fromBeginning: true,
      db: this.db,
      producer: this.producer,
      logger: this.logger,
      handler: async (payload) => this.procesar(payload as EventoEstado),
    });
    this.servicio = servicio;
    this.iniciadoEn = Date.now();
    this.chequeosEnCero = 0;
    await servicio.start();
    this.watcher = setInterval(() => void this.verificarFin(), 1_500);
    this.logger.info("replay del cuarto indicador iniciado desde el inicio del topic");
    return this.status;
  }

  /**
   * El replay es de una sola pasada: cuando el grupo alcanza el punto capturado
   * al inicio se detiene solo. Asi el boton vuelve a quedar disponible.
   */
  private async verificarFin(): Promise<void> {
    if (!this.servicio || this.verificando) return;
    if (Date.now() - this.iniciadoEn < 5_000) return;
    this.verificando = true;
    try {
      const pendientes = await this.pendientesDelReplay();
      if (pendientes === 0) {
        this.chequeosEnCero += 1;
        if (this.chequeosEnCero >= 2) {
          const procesados = this.procesados;
          await this.detener();
          this.logger.info({ procesados }, "replay del cuarto indicador completado");
        }
      } else {
        this.chequeosEnCero = 0;
      }
    } catch (error) {
      this.logger.warn({ error: (error as Error).message }, "no se pudo verificar el fin del replay");
    } finally {
      this.verificando = false;
    }
  }

  /** High watermark de cada particion en el momento de iniciar el replay. */
  private async offsetsObjetivo(): Promise<Map<number, number>> {
    const admin = this.kafka.admin();
    await admin.connect();
    try {
      const offsets = await admin.fetchTopicOffsets(TOPICS.estados);
      return new Map(offsets.map((o) => [o.partition, Number(o.high)]));
    } finally {
      await admin.disconnect().catch(() => undefined);
    }
  }

  /**
   * Mensajes que faltan para llegar al objetivo. Si el grupo todavia no
   * commiteo nada, se considera que esta en el inicio (offset 0).
   */
  private async pendientesDelReplay(): Promise<number> {
    const admin = this.kafka.admin();
    await admin.connect();
    try {
      let committed: Awaited<ReturnType<typeof admin.fetchOffsets>> = [];
      try {
        committed = await admin.fetchOffsets({ groupId: GRUPOS.analiticaReplay });
      } catch {
        committed = [];
      }
      const offsets = new Map<number, number>();
      for (const t of committed) {
        if (t.topic !== TOPICS.estados) continue;
        for (const p of t.partitions) {
          const valor = Number(p.offset);
          if (Number.isFinite(valor) && valor >= 0) offsets.set(p.partition, valor);
        }
      }
      let pendientes = 0;
      for (const [partition, high] of this.objetivos) {
        pendientes += Math.max(0, high - (offsets.get(partition) ?? 0));
      }
      return pendientes;
    } finally {
      await admin.disconnect().catch(() => undefined);
    }
  }

  private async procesar(evento: EventoEstado): Promise<void> {
    if (evento.tipo === "INGRESADO_HUB") {
      this.ingresos.set(evento.shipmentId, new Date(evento.ocurridoEn));
      return;
    }
    if (evento.tipo !== "EN_REPARTO") return;

    const ingreso = this.ingresos.get(evento.shipmentId);
    if (!ingreso) return;

    const enReparto = new Date(evento.ocurridoEn);
    await this.db.collection(COL.tiemposHub).updateOne(
      { shipmentId: evento.shipmentId },
      {
        $set: {
          shipmentId: evento.shipmentId,
          hubId: evento.hubId ?? "SIN-HUB",
          fecha: fechaTz(enReparto),
          ingresadoEn: ingreso,
          enRepartoEn: enReparto,
          minutos: minutosEntre(ingreso, enReparto),
          actualizadoEn: new Date(),
        },
      },
      { upsert: true },
    );
    this.procesados += 1;
  }

  async detener(): Promise<void> {
    if (this.watcher) clearInterval(this.watcher);
    this.watcher = null;
    await this.servicio?.stop();
    this.servicio = null;
  }

  async limpiar(): Promise<void> {
    await this.detener();
    this.ingresos.clear();
    this.procesados = 0;
    this.chequeosEnCero = 0;
    this.objetivos.clear();
    await this.db.collection(COL.tiemposHub).deleteMany({});
    await this.db.collection(COL.procesados).deleteMany({ consumidor: GRUPOS.analiticaReplay });

    const admin = this.kafka.admin();
    await admin.connect().catch(() => undefined);
    await admin.deleteGroups([GRUPOS.analiticaReplay]).catch(() => undefined);
    await admin.disconnect().catch(() => undefined);
  }
}
