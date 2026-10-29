import type { ClientSession, Db } from "mongodb";
import type { Kafka } from "kafkajs";
import {
  COL,
  TOPICS,
  calcularLag,
  fechaTz,
  franjaDe,
  type EventoEstado,
  type Logger,
} from "@rutasur/shared";

/**
 * CU4: convierte los eventos en agregados incrementales por fecha, zona, hub y
 * franja. Los incrementos son atomicos ($inc) y se aplican en la misma
 * transaccion que registra el eventId, para no contar dos veces.
 */
export class MetricasService {
  private readonly promesas = new Map<string, Date>();

  constructor(
    private readonly db: Db,
    private readonly logger: Logger,
  ) {}

  /**
   * El topic de promesas esta compactado: al arrancar se lee completo para
   * reconstruir el mapa en memoria sin depender de offsets viejos.
   */
  async preloadPromesas(kafka: Kafka): Promise<number> {
    const groupId = `analitica-promesas-preload-${Date.now()}`;
    const consumer = kafka.consumer({ groupId, sessionTimeout: 30_000 });
    let cantidad = 0;
    try {
      await consumer.connect();
      await consumer.subscribe({ topic: TOPICS.promesas, fromBeginning: true });
      await consumer.run({
        eachMessage: async ({ message }) => {
          try {
            const p = JSON.parse(message.value?.toString("utf8") ?? "{}");
            if (p?.shipmentId && p?.promesa?.venceEn) {
              this.promesas.set(p.shipmentId, new Date(p.promesa.venceEn));
              cantidad += 1;
            }
          } catch {
            // mensaje invalido: el proyector y el monitor lo mandan a la DLQ
          }
        },
      });
      // Se espera a que el grupo alcance el final del topic compactado en lugar
      // de usar un tiempo fijo: con un historico grande, 2 segundos no alcanzan.
      const inicio = Date.now();
      while (Date.now() - inicio < 12_000) {
        await new Promise((r) => setTimeout(r, 300));
        if (Date.now() - inicio < 1_000) continue;
        const lag = await calcularLag(kafka, [groupId]).catch(() => []);
        const info = lag[0];
        if (info && info.particiones.length > 0 && info.total === 0) break;
      }
    } catch (error) {
      this.logger.warn({ error: (error as Error).message }, "no se pudieron precargar promesas");
    } finally {
      await consumer.disconnect().catch(() => undefined);
      const admin = kafka.admin();
      await admin.connect().catch(() => undefined);
      await admin.deleteGroups([groupId]).catch(() => undefined);
      await admin.disconnect().catch(() => undefined);
    }
    this.logger.info({ promesas: cantidad }, "promesas precargadas");
    return cantidad;
  }

  async procesar(payload: any, topic: string, session?: ClientSession): Promise<void> {
    if (topic === TOPICS.promesas) {
      if (payload?.shipmentId && payload?.promesa?.venceEn) {
        this.promesas.set(payload.shipmentId, new Date(payload.promesa.venceEn));
      }
      return;
    }
    if (topic !== TOPICS.estados) return;

    const evento = payload as EventoEstado;
    if (evento.tipo !== "ENTREGADO" && evento.tipo !== "ENTREGA_FALLIDA") return;

    const ocurridoEn = new Date(evento.ocurridoEn);
    const fecha = fechaTz(ocurridoEn);
    const franja = franjaDe(ocurridoEn);
    const zonaId = evento.zonaId ?? "SIN-ZONA";
    const hubId = evento.hubId ?? "SIN-HUB";
    const intento = evento.intento ?? 1;

    const inc: Record<string, number> = { intentos: 1 };

    if (evento.tipo === "ENTREGADO") {
      inc.entregas = 1;
      if (intento === 1) inc.entregasPrimerIntento = 1;
      const vence = this.promesas.get(evento.shipmentId);
      if (vence && ocurridoEn.getTime() <= vence.getTime()) inc.entregasEnFecha = 1;
    } else {
      inc.fallos = 1;
      if (intento === 1) inc.primerosIntentosFallidos = 1;
      inc[`fallosPorMotivo.${evento.motivo ?? "SIN_MOTIVO"}`] = 1;
    }

    const filtro = { fecha, zonaId, hubId, franja };
    const update = { $inc: inc, $set: { actualizadoEn: new Date() } };

    try {
      await this.db
        .collection(COL.metricas)
        .updateOne(filtro, update, { upsert: true, session });
    } catch (error) {
      // Dos particiones pueden crear la misma metrica al mismo tiempo. Dentro
      // de una transaccion el error la aborta: se relanza para que el
      // consumidor reintente la transaccion completa (ya con la metrica creada).
      if ((error as { code?: number }).code === 11000) {
        if (session) throw error;
        await this.db.collection(COL.metricas).updateOne(filtro, update);
        return;
      }
      throw error;
    }
  }
}
