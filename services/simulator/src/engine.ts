import type { Db } from "mongodb";
import {
  COL,
  TOPICS,
  type DocumentoPendiente,
  type EventoEstado,
  type EventoPromesa,
  type Franja,
  type MotivoFallo,
  type EstadoTipo,
  type EventProducer,
  type Logger,
  fechaTz,
  franjaDe,
  sumarHoras,
  sumarMinutos,
} from "@rutasur/shared";
import { Rng } from "./rng";
import { ZONAS, elegirMotivo, repartidor, zonaPorId, type Zona } from "./zonas";

interface EventoPlanificado {
  at: number;
  evento: EventoEstado;
}

interface EnvioSimulado {
  shipmentId: string;
  zona: Zona;
  plan: EventoPlanificado[];
  cursor: number;
}

interface OpcionesEnvio {
  forzarResultado?: "ENTREGADO" | "ENTREGA_FALLIDA";
  forzarMotivo?: MotivoFallo;
  demorado?: boolean;
  intentoBase?: number;
  rapido?: boolean;
  promesaHoras?: number;
  zona?: Zona;
}

export interface EstadoSimulador {
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

const ESTADO_ID = "default";

export class SimulatorEngine {
  private envios = new Map<string, EnvioSimulado>();
  private pendientes = new Map<string, DocumentoPendiente>();
  private cola: Array<{ topic: string; key: string; value: unknown }> = [];
  private ultimoEstado: { key: string; value: EventoEstado } | null = null;
  private primerosEventos = new Map<string, EventoEstado>();
  private ultimosEventos = new Map<string, EventoEstado>();
  private rng: Rng;
  private simNow: number;
  private ultimoTick: number;
  private acumulador = 0;
  private contador = 0;
  private pausado = false;
  private rate: number;
  private publicados = 0;
  private tickEnCurso = false;
  private intervalo: NodeJS.Timeout | null = null;
  private ultimoGuardado = 0;
  private readonly inicio: number;

  constructor(
    private readonly db: Db,
    private readonly producer: EventProducer,
    private readonly logger: Logger,
    private readonly speed: number,
    rateInicial: number,
    private readonly seed: number,
  ) {
    this.rate = rateInicial;
    this.rng = new Rng(seed);
    this.inicio = this.calcularInicio();
    this.simNow = this.inicio;
    this.ultimoTick = Date.now();
  }

  private calcularInicio(): number {
    const hoy = fechaTz(new Date());
    const hora = String(Number(process.env.SIM_START_HOUR ?? 8)).padStart(2, "0");
    return new Date(`${hoy}T${hora}:00:00-03:00`).getTime();
  }

  async start(): Promise<void> {
    await this.cargarEstado();
    this.intervalo = setInterval(() => {
      void this.tick();
    }, 250);
    this.logger.info(
      { simNow: new Date(this.simNow).toISOString(), speed: this.speed, rate: this.rate },
      "simulador iniciado",
    );
  }

  async stop(): Promise<void> {
    if (this.intervalo) clearInterval(this.intervalo);
    this.intervalo = null;
    await this.flush();
    await this.guardarEstado();
  }

  private async cargarEstado(): Promise<void> {
    const doc = await this.db.collection(COL.simState).findOne({ _id: ESTADO_ID as never });
    if (doc?.simNow instanceof Date) {
      const guardado = doc.simNow.getTime();
      this.simNow = Math.max(guardado, this.inicio);
      this.contador = Number(doc.contador ?? 0);
      this.pausado = Boolean(doc.pausado);
      if (Number.isFinite(Number(doc.rate)) && Number(doc.rate) > 0) this.rate = Number(doc.rate);
      this.logger.info(
        { simNow: new Date(this.simNow).toISOString(), contador: this.contador },
        "estado del simulador recuperado",
      );
    }

    const pendientes = await this.db
      .collection<DocumentoPendiente>(COL.pendientes)
      .find({ estado: { $in: ["PENDIENTE", "EMITIDA"] } })
      .toArray();
    for (const p of pendientes) this.pendientes.set(p._id, p);
    if (pendientes.length > 0) {
      this.logger.info({ pendientes: pendientes.length }, "reintentos pendientes recuperados");
    }
  }

  private async guardarEstado(): Promise<void> {
    await this.db.collection(COL.simState).updateOne(
      { _id: ESTADO_ID as never },
      {
        $set: {
          simNow: new Date(this.simNow),
          contador: this.contador,
          speed: this.speed,
          rate: this.rate,
          seed: this.seed,
          pausado: this.pausado,
          actualizadoEn: new Date(),
        },
      },
      { upsert: true },
    );
  }

  private nuevoShipmentId(): string {
    this.contador += 1;
    return `SHP-${String(this.contador).padStart(6, "0")}`;
  }

  private armarEvento(
    shipmentId: string,
    secuencia: number,
    tipo: EstadoTipo,
    ocurridoEn: Date,
    zona: Zona,
    repartidorId: string,
    intento: number,
    extra: Partial<EventoEstado> = {},
  ): EventoEstado {
    return {
      eventId: `evt-${shipmentId}-${secuencia}`,
      shipmentId,
      tipo,
      ocurridoEn: ocurridoEn.toISOString(),
      secuencia,
      version: 1,
      hubId: zona.hubId,
      zonaId: zona.zonaId,
      repartidorId,
      intento,
      ...extra,
    };
  }

  private emitir(topic: string, key: string, value: unknown): void {
    this.cola.push({ topic, key, value });
  }

  private async flush(): Promise<void> {
    if (this.cola.length === 0) return;
    const lote = this.cola;
    this.cola = [];
    const porTopic = new Map<string, Array<{ key: string; value: unknown }>>();
    for (const m of lote) {
      const lista = porTopic.get(m.topic) ?? [];
      lista.push({ key: m.key, value: m.value });
      porTopic.set(m.topic, lista);
    }
    for (const [topic, mensajes] of porTopic) {
      await this.producer.enviarLote(topic, mensajes);
      this.publicados += mensajes.length;
    }
  }

  private crearEnvio(opciones: OpcionesEnvio = {}): string {
    const zona = opciones.zona ?? this.rng.pick(ZONAS);
    const shipmentId = this.nuevoShipmentId();
    const creado = new Date(this.simNow);
    const promesaHoras =
      opciones.promesaHoras ??
      (this.rng.chance(0.05) ? this.rng.int(8, 10) : this.rng.int(18, 30));
    const vence = sumarHoras(creado, promesaHoras);
    const franja = franjaDe(vence);
    const rep = repartidor(this.rng);
    const intentoBase = opciones.intentoBase ?? 1;
    const f = opciones.rapido ? 0.25 : 1;
    const plan: EventoPlanificado[] = [];
    let secuencia = 1;

    const agregar = (
      fecha: Date,
      tipo: EstadoTipo,
      intento: number,
      extra: Partial<EventoEstado> = {},
    ): void => {
      const evento = this.armarEvento(shipmentId, secuencia, tipo, fecha, zona, rep, intento, extra);
      secuencia += 1;
      plan.push({ at: fecha.getTime(), evento });
    };

    agregar(creado, "CREADO", 1);
    const ingreso = sumarMinutos(
      creado,
      opciones.demorado ? 60 : Math.round(this.rng.int(60, 180) * f),
    );
    agregar(ingreso, "INGRESADO_HUB", 1);

    if (!opciones.demorado) {
      const clasificado = sumarMinutos(ingreso, Math.round(this.rng.int(10, 30) * f));
      agregar(clasificado, "CLASIFICADO", intentoBase);
      const reparto = sumarMinutos(clasificado, Math.round(this.rng.int(20, 60) * f));
      agregar(reparto, "EN_REPARTO", intentoBase, intentoBase > 1 ? { reintento: true } : {});
      const resultadoEn = sumarMinutos(reparto, Math.round(this.rng.int(60, 180) * f));

      const falla =
        opciones.forzarResultado === "ENTREGA_FALLIDA" ||
        (opciones.forzarResultado === undefined && this.rng.chance(zona.tasaFallo));
      if (falla) {
        const motivo = opciones.forzarMotivo ?? elegirMotivo(this.rng);
        agregar(resultadoEn, "ENTREGA_FALLIDA", intentoBase, { motivo });
      } else {
        agregar(resultadoEn, "ENTREGADO", intentoBase);
      }
    }

    const promesa: EventoPromesa = {
      eventId: `prm-${shipmentId}-1`,
      shipmentId,
      tipo: "PROMESA",
      ocurridoEn: creado.toISOString(),
      secuencia: 1,
      version: 1,
      hubId: zona.hubId,
      zonaId: zona.zonaId,
      repartidorId: rep,
      promesa: {
        venceEn: vence.toISOString(),
        franja,
        compromiso: `${franja} ${vence.toISOString().slice(0, 10)}`,
      },
    };

    this.emitir(TOPICS.promesas, shipmentId, promesa);
    this.envios.set(shipmentId, { shipmentId, zona, plan, cursor: 0 });
    return shipmentId;
  }

  private avanzarEnvios(): void {
    for (const envio of this.envios.values()) {
      while (envio.cursor < envio.plan.length) {
        const paso = envio.plan[envio.cursor];
        if (!paso || paso.at > this.simNow) break;
        envio.cursor += 1;
        this.emitir(TOPICS.estados, envio.shipmentId, paso.evento);
        this.ultimoEstado = { key: envio.shipmentId, value: paso.evento };
        if (!this.primerosEventos.has(envio.shipmentId)) {
          this.primerosEventos.set(envio.shipmentId, paso.evento);
        }
        this.ultimosEventos.set(envio.shipmentId, paso.evento);
      }
      if (envio.cursor >= envio.plan.length) {
        this.envios.delete(envio.shipmentId);
      }
    }
  }

  private async avanzarPendientes(): Promise<void> {
    for (const pendiente of [...this.pendientes.values()]) {
      try {
        if (pendiente.estado === "PENDIENTE" && pendiente.programadaPara.getTime() <= this.simNow) {
          const fresco = await this.db
            .collection<DocumentoPendiente>(COL.pendientes)
            .findOne({ _id: pendiente._id });
          if (!fresco || fresco.estado !== "PENDIENTE") {
            if (fresco) this.pendientes.set(fresco._id, fresco);
            else this.pendientes.delete(pendiente._id);
            continue;
          }
          const cuando = new Date(pendiente.programadaPara);
          const seq = pendiente.ultimaSecuencia + 1;
          const zona = zonaPorId(pendiente.zonaId) ?? ZONAS[0]!;
          const evento = this.armarEvento(
            pendiente.shipmentId,
            seq,
            "EN_REPARTO",
            cuando,
            zona,
            pendiente.repartidorId ?? repartidor(this.rng),
            pendiente.intentoNuevo,
            { reintento: true },
          );
          this.emitir(TOPICS.estados, pendiente.shipmentId, evento);
          this.ultimoEstado = { key: pendiente.shipmentId, value: evento };
          this.ultimosEventos.set(pendiente.shipmentId, evento);

          const resultado =
            pendiente.resultadoForzado ??
            (this.rng.chance(zona.tasaFallo) ? "ENTREGA_FALLIDA" : "ENTREGADO");
          const motivo = resultado === "ENTREGA_FALLIDA" ? elegirMotivo(this.rng) : undefined;
          const resultadoEn = sumarHoras(cuando, 2);

          const actualizado: DocumentoPendiente = {
            ...pendiente,
            estado: "EMITIDA",
            ultimaSecuencia: seq,
            resultadoEn,
            resultadoForzado: resultado,
            resultadoMotivo: motivo ?? null,
            actualizadoEn: new Date(),
          };
          await this.db
            .collection<DocumentoPendiente>(COL.pendientes)
            .updateOne(
              { _id: pendiente._id },
              {
                $set: {
                  estado: "EMITIDA",
                  ultimaSecuencia: seq,
                  resultadoEn,
                  resultadoForzado: resultado,
                  resultadoMotivo: motivo ?? null,
                  actualizadoEn: new Date(),
                },
              },
            );
          this.pendientes.set(actualizado._id, actualizado);
        } else if (pendiente.estado === "EMITIDA" && pendiente.resultadoEn) {
          if (pendiente.resultadoEn.getTime() > this.simNow) continue;
          const fresco = await this.db
            .collection<DocumentoPendiente>(COL.pendientes)
            .findOne({ _id: pendiente._id });
          if (!fresco || fresco.estado !== "EMITIDA") {
            if (fresco) this.pendientes.set(fresco._id, fresco);
            else this.pendientes.delete(pendiente._id);
            continue;
          }
          const zona = zonaPorId(pendiente.zonaId) ?? ZONAS[0]!;
          const seq = pendiente.ultimaSecuencia + 1;
          const falla = pendiente.resultadoForzado === "ENTREGA_FALLIDA";
          const evento = this.armarEvento(
            pendiente.shipmentId,
            seq,
            falla ? "ENTREGA_FALLIDA" : "ENTREGADO",
            pendiente.resultadoEn,
            zona,
            pendiente.repartidorId ?? repartidor(this.rng),
            pendiente.intentoNuevo,
            falla ? { motivo: pendiente.resultadoMotivo ?? "AUSENTE" } : {},
          );
          this.emitir(TOPICS.estados, pendiente.shipmentId, evento);
          this.ultimoEstado = { key: pendiente.shipmentId, value: evento };
          this.ultimosEventos.set(pendiente.shipmentId, evento);
          await this.db
            .collection<DocumentoPendiente>(COL.pendientes)
            .updateOne(
              { _id: pendiente._id },
              { $set: { estado: "COMPLETADA", ultimaSecuencia: seq, actualizadoEn: new Date() } },
            );
          this.pendientes.delete(pendiente._id);
        }
      } catch (error) {
        this.logger.error(
          { error: (error as Error).message, shipmentId: pendiente.shipmentId },
          "error procesando reintento",
        );
      }
    }
  }

  private async tick(): Promise<void> {
    if (this.tickEnCurso) return;
    this.tickEnCurso = true;
    try {
      const ahora = Date.now();
      const deltaReal = Math.max(0, ahora - this.ultimoTick);
      this.ultimoTick = ahora;
      if (this.pausado) return;

      const deltaSim = deltaReal * this.speed;
      this.simNow += deltaSim;
      // SIM_RATE es el volumen de la demo en tiempo real (envios por minuto).
      // El factor SIM_SPEED solo comprime los tiempos de cada envio; si tambien
      // multiplicara la tasa, 20/min x 120 serian 40 envios por segundo y los
      // consumidores no podrian seguir el ritmo.
      this.acumulador += (this.rate / 60_000) * deltaReal;
      let creados = 0;
      while (this.acumulador >= 1 && creados < 200) {
        this.acumulador -= 1;
        this.crearEnvio();
        creados += 1;
      }

      this.avanzarEnvios();
      await this.avanzarPendientes();
      await this.flush();

      if (ahora - this.ultimoGuardado > 5_000) {
        this.ultimoGuardado = ahora;
        await this.guardarEstado();
      }
    } catch (error) {
      this.logger.error({ error: (error as Error).message }, "error en tick del simulador");
    } finally {
      this.tickEnCurso = false;
    }
  }

  async escenario(nombre: string): Promise<{ ok: true; detalle: string; shipmentId?: string }> {
    switch (nombre) {
      case "feliz": {
        const shipmentId = this.crearEnvio({ forzarResultado: "ENTREGADO", rapido: true });
        return { ok: true, detalle: "Envio feliz creado", shipmentId };
      }
      case "ausente": {
        const shipmentId = this.crearEnvio({
          forzarResultado: "ENTREGA_FALLIDA",
          forzarMotivo: "AUSENTE",
          rapido: true,
        });
        return { ok: true, detalle: "Envio con fallo AUSENTE creado", shipmentId };
      }
      case "demorado": {
        const shipmentId = this.crearEnvio({ demorado: true, promesaHoras: 6 });
        return { ok: true, detalle: "Envio demorado en el hub", shipmentId };
      }
      case "tercer-fallo": {
        const shipmentId = this.crearEnvio({
          forzarResultado: "ENTREGA_FALLIDA",
          intentoBase: 3,
          rapido: true,
        });
        return { ok: true, detalle: "Envio con tercer fallo: pasa a devolucion", shipmentId };
      }
      case "rafaga": {
        for (let i = 0; i < 500; i += 1) this.crearEnvio();
        return { ok: true, detalle: "Rafaga de 500 envios creada" };
      }
      default:
        throw new Error(`escenario desconocido: ${nombre}`);
    }
  }

  async inyectar(tipo: string): Promise<{ ok: true; detalle: string }> {
    if (tipo === "malformado") {
      this.emitir(TOPICS.estados, "SHP-MALFORMADO", {
        shipmentId: "SHP-MALFORMADO",
        tipo: "ESTADO_INEXISTENTE",
        ocurridoEn: new Date(this.simNow).toISOString(),
        secuencia: 1,
        version: 1,
      });
      this.emitir(TOPICS.estados, "SHP-MALFORMADO", "{esto no es json");
      await this.flush();
      return { ok: true, detalle: "Eventos malformados inyectados: revisar la DLQ" };
    }

    if (tipo === "duplicado") {
      if (!this.ultimoEstado) throw new Error("todavia no hay eventos para duplicar");
      this.emitir(TOPICS.estados, this.ultimoEstado.key, this.ultimoEstado.value);
      await this.flush();
      return {
        ok: true,
        detalle: `Evento ${this.ultimoEstado.value.eventId} reenviado con el mismo eventId`,
      };
    }

    if (tipo === "fuera-de-orden") {
      const candidato = [...this.ultimosEventos.entries()]
        .reverse()
        .find(([, e]) => e.secuencia > 1);
      if (!candidato) throw new Error("todavia no hay envios avanzados");
      const [shipmentId] = candidato;
      const primero = this.primerosEventos.get(shipmentId);
      if (!primero) throw new Error("no se encontro el primer evento del envio");
      const atrasado: EventoEstado = {
        ...primero,
        eventId: `evt-${shipmentId}-desorden-${Date.now()}`,
        ocurridoEn: new Date(this.simNow).toISOString(),
      };
      this.emitir(TOPICS.estados, shipmentId, atrasado);
      await this.flush();
      return {
        ok: true,
        detalle: `Evento con secuencia 1 reinyectado para ${shipmentId} (debe descartarse)`,
      };
    }

    throw new Error(`inyeccion desconocida: ${tipo}`);
  }

  async control(body: { pausado?: boolean; rate?: number }): Promise<{ ok: true; estado: EstadoSimulador }> {
    if (typeof body.pausado === "boolean") this.pausado = body.pausado;
    if (typeof body.rate === "number" && body.rate > 0) this.rate = body.rate;
    await this.guardarEstado();
    return { ok: true, estado: this.status() };
  }

  async reset(): Promise<void> {
    this.envios.clear();
    this.pendientes.clear();
    this.primerosEventos.clear();
    this.ultimosEventos.clear();
    this.ultimoEstado = null;
    // No se reinicia el contador: los IDs ya emitidos siguen en el log de
    // Kafka y reutilizarlos haria que los consumidores los descarten.
    this.acumulador = 0;
    this.publicados = 0;
    this.simNow = this.inicio;
    this.rng = new Rng(this.seed);
    await this.db.collection(COL.pendientes).deleteMany({});
    await this.db.collection(COL.simState).deleteMany({});
    await this.guardarEstado();
    this.logger.info("simulador reiniciado");
  }

  status(): EstadoSimulador {
    return {
      simNow: new Date(this.simNow).toISOString(),
      speed: this.speed,
      rate: this.rate,
      pausado: this.pausado,
      enviosActivos: this.envios.size,
      pendientes: this.pendientes.size,
      publicados: this.publicados,
      seed: this.seed,
      horaInicio: new Date(this.inicio).toISOString(),
    };
  }
}
