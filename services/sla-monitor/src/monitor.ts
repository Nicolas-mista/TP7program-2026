import type { Db } from "mongodb";
import {
  COL,
  PRIORIDAD_POR_REGLA,
  TOPICS,
  causaAlerta,
  evaluarSla,
  idAlerta,
  simClock,
  type EventoAlertaSla,
  type EventoEstado,
  type EventoPromesa,
  type EventProducer,
  type Logger,
  type ReglaSla,
} from "@rutasur/shared";
import { MonitorState, type EstadoMonitor } from "./state";

/**
 * CU3: cruza el ultimo estado de cada envio con su promesa y evalua el paso
 * del tiempo. Usa el reloj simulado (tiempo de evento), no el reloj real.
 */
export class SlaMonitor {
  private readonly state: MonitorState;
  private ticker: NodeJS.Timeout | null = null;
  private tickEnCurso = false;

  constructor(
    db: Db,
    private readonly producer: EventProducer,
    private readonly logger: Logger,
  ) {
    this.state = new MonitorState(db);
  }

  async init(): Promise<void> {
    const recuperados = await this.state.cargar();
    this.logger.info({ recuperados }, "estado del monitor recuperado");
    this.ticker = setInterval(() => void this.tick(), 2_000);
  }

  async stop(): Promise<void> {
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
    await this.state.persistir();
  }

  async limpiar(): Promise<void> {
    await this.state.limpiar();
  }

  get seguimientos(): number {
    return this.state.cantidad;
  }

  async procesar(payload: any, topic: string): Promise<void> {
    if (topic === TOPICS.promesas) return this.onPromesa(payload as EventoPromesa);
    if (topic === TOPICS.estados) return this.onEstado(payload as EventoEstado);
  }

  private async onPromesa(payload: EventoPromesa): Promise<void> {
    const s = this.state.obtener(payload.shipmentId) ?? this.state.crear(payload.shipmentId);
    const venceEn = new Date(payload.promesa.venceEn);
    if (!Number.isNaN(venceEn.getTime())) s.venceEn = venceEn;
    if (!s.hubId) s.hubId = payload.hubId ?? null;
    if (!s.zonaId) s.zonaId = payload.zonaId ?? null;
    this.state.marcar(s.shipmentId);
    await this.evaluar(s);
  }

  private async onEstado(payload: EventoEstado): Promise<void> {
    const s = this.state.obtener(payload.shipmentId) ?? this.state.crear(payload.shipmentId);

    // Misma regla de orden que el proyector: no retroceder con eventos viejos.
    if (payload.secuencia <= s.ultimaSecuencia) return;

    s.estado = payload.tipo;
    s.ultimaSecuencia = payload.secuencia;
    s.intento = payload.intento ?? s.intento;
    if (payload.hubId) s.hubId = payload.hubId;
    if (payload.zonaId) s.zonaId = payload.zonaId;
    this.state.marcar(s.shipmentId);

    if (payload.tipo === "ENTREGADO") {
      await this.cerrarAlertas(s);
      this.state.eliminar(s.shipmentId);
      return;
    }

    await this.evaluar(s);
  }

  private async evaluar(s: EstadoMonitor): Promise<void> {
    if (!s.venceEn || s.estado === "ENTREGADO") return;
    const ahora = simClock().now();
    const reglas = evaluarSla({
      estado: s.estado,
      venceEn: s.venceEn,
      ahora,
      reglasDisparadas: [...s.reglasDisparadas],
    });

    for (const regla of reglas) {
      s.reglasDisparadas.add(regla);
      const alertaId = idAlerta(s.shipmentId, regla);
      s.alertasAbiertas.set(regla, alertaId);
      this.state.marcar(s.shipmentId);

      const evento: EventoAlertaSla = {
        eventId: `alr-${alertaId}-apertura`,
        shipmentId: s.shipmentId,
        tipo: "ALERTA_SLA",
        ocurridoEn: ahora.toISOString(),
        secuencia: Math.max(1, s.ultimaSecuencia),
        version: 1,
        hubId: s.hubId,
        zonaId: s.zonaId,
        repartidorId: null,
        alertaId,
        regla,
        prioridad: PRIORIDAD_POR_REGLA[regla],
        causa: causaAlerta(regla, s.venceEn, ahora),
        estado: "ABIERTA",
        venceEn: s.venceEn.toISOString(),
      };
      await this.producer.enviar(TOPICS.alertas, s.shipmentId, evento);
      this.logger.info(
        { shipmentId: s.shipmentId, regla, alertaId, prioridad: evento.prioridad },
        "alerta de SLA abierta",
      );
    }
  }

  private async cerrarAlertas(s: EstadoMonitor): Promise<void> {
    if (s.alertasAbiertas.size === 0) return;
    const ahora = simClock().now();
    for (const [regla, alertaId] of s.alertasAbiertas) {
      const evento: EventoAlertaSla = {
        eventId: `alr-${alertaId}-cierre`,
        shipmentId: s.shipmentId,
        tipo: "ALERTA_SLA",
        ocurridoEn: ahora.toISOString(),
        secuencia: Math.max(1, s.ultimaSecuencia),
        version: 1,
        hubId: s.hubId,
        zonaId: s.zonaId,
        repartidorId: null,
        alertaId,
        regla,
        prioridad: PRIORIDAD_POR_REGLA[regla as ReglaSla],
        causa: "Envio entregado: alerta cerrada",
        estado: "CERRADA",
        venceEn: s.venceEn?.toISOString() ?? ahora.toISOString(),
      };
      await this.producer.enviar(TOPICS.alertas, s.shipmentId, evento);
    }
    s.alertasAbiertas.clear();
    this.state.marcar(s.shipmentId);
  }

  private async tick(): Promise<void> {
    if (this.tickEnCurso) return;
    this.tickEnCurso = true;
    try {
      for (const s of this.state.todos()) {
        await this.evaluar(s);
      }
      await this.state.persistir();
    } catch (error) {
      this.logger.error({ error: (error as Error).message }, "error en evaluacion periodica");
    } finally {
      this.tickEnCurso = false;
    }
  }
}
