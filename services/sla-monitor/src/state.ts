import type { Db } from "mongodb";
import {
  COL,
  type DocumentoSlaEstado,
  type EstadoTipo,
  type ReglaSla,
} from "@rutasur/shared";

export interface EstadoMonitor {
  shipmentId: string;
  estado: EstadoTipo;
  venceEn: Date | null;
  intento: number;
  hubId: string | null;
  zonaId: string | null;
  ultimaSecuencia: number;
  reglasDisparadas: Set<ReglaSla>;
  alertasAbiertas: Map<ReglaSla, string>;
}

/** Estado en memoria con respaldo en MongoDB (coleccion sla_estado). */
export class MonitorState {
  private readonly estados = new Map<string, EstadoMonitor>();
  private readonly sucios = new Set<string>();
  private readonly borrados = new Set<string>();

  constructor(private readonly db: Db) {}

  async cargar(): Promise<number> {
    const docs = await this.db
      .collection<DocumentoSlaEstado>(COL.slaEstado)
      .find({})
      .toArray();
    for (const d of docs) {
      this.estados.set(d._id, {
        shipmentId: d.shipmentId,
        estado: d.estado,
        venceEn: d.venceEn ? new Date(d.venceEn) : null,
        intento: d.intento,
        hubId: d.hubId ?? null,
        zonaId: d.zonaId ?? null,
        ultimaSecuencia: d.ultimaSecuencia ?? 0,
        reglasDisparadas: new Set(d.reglasDisparadas ?? []),
        alertasAbiertas: new Map(
          (d.alertasAbiertas ?? []).map((a) => [a.regla, a.alertaId] as const),
        ),
      });
    }
    return docs.length;
  }

  obtener(shipmentId: string): EstadoMonitor | undefined {
    return this.estados.get(shipmentId);
  }

  crear(shipmentId: string): EstadoMonitor {
    const estado: EstadoMonitor = {
      shipmentId,
      estado: "CREADO",
      venceEn: null,
      intento: 1,
      hubId: null,
      zonaId: null,
      ultimaSecuencia: 0,
      reglasDisparadas: new Set(),
      alertasAbiertas: new Map(),
    };
    this.estados.set(shipmentId, estado);
    this.sucios.add(shipmentId);
    return estado;
  }

  marcar(shipmentId: string): void {
    this.sucios.add(shipmentId);
  }

  eliminar(shipmentId: string): void {
    this.estados.delete(shipmentId);
    this.sucios.delete(shipmentId);
    this.borrados.add(shipmentId);
  }

  todos(): IterableIterator<EstadoMonitor> {
    return this.estados.values();
  }

  get cantidad(): number {
    return this.estados.size;
  }

  async persistir(): Promise<void> {
    if (this.sucios.size === 0 && this.borrados.size === 0) return;
    const ops: any[] = [];
    for (const id of this.sucios) {
      const s = this.estados.get(id);
      if (!s) continue;
      ops.push({
        updateOne: {
          filter: { _id: id },
          update: {
            $set: {
              shipmentId: s.shipmentId,
              estado: s.estado,
              venceEn: s.venceEn,
              intento: s.intento,
              hubId: s.hubId,
              zonaId: s.zonaId,
              ultimaSecuencia: s.ultimaSecuencia,
              reglasDisparadas: [...s.reglasDisparadas],
              alertasAbiertas: [...s.alertasAbiertas.entries()].map(([regla, alertaId]) => ({
                regla,
                alertaId,
              })),
              actualizadoEn: new Date(),
            },
          },
          upsert: true,
        },
      });
    }
    for (const id of this.borrados) {
      ops.push({ deleteOne: { filter: { _id: id } } });
    }
    if (ops.length > 0) {
      await this.db.collection(COL.slaEstado).bulkWrite(ops, { ordered: false });
    }
    this.sucios.clear();
    this.borrados.clear();
  }

  async limpiar(): Promise<void> {
    this.estados.clear();
    this.sucios.clear();
    this.borrados.clear();
    await this.db.collection(COL.slaEstado).deleteMany({});
  }
}
