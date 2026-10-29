import { describe, expect, it } from "vitest";
import { TOPICS } from "../topics";
import { validarEvento } from "./validate";

const base = {
  eventId: "evt-1",
  shipmentId: "SHP-1",
  ocurridoEn: "2026-05-04T12:00:00.000Z",
  secuencia: 1,
  version: 1,
  hubId: "HUB-CEN",
  zonaId: "Z-01",
  repartidorId: null,
};

describe("validacion de eventos", () => {
  it("acepta un estado valido", () => {
    expect(validarEvento(TOPICS.estados, { ...base, tipo: "CREADO" }).ok).toBe(true);
  });

  it("rechaza un tipo desconocido", () => {
    expect(validarEvento(TOPICS.estados, { ...base, tipo: "VOLANDO" }).ok).toBe(false);
  });

  it("exige motivo en ENTREGA_FALLIDA", () => {
    const r = validarEvento(TOPICS.estados, { ...base, tipo: "ENTREGA_FALLIDA", intento: 1 });
    expect(r.ok).toBe(false);
    expect(r.errores.join(" ")).toContain("motivo");
  });

  it("acepta una reprogramacion completa", () => {
    const r = validarEvento(TOPICS.reprogramaciones, {
      ...base,
      tipo: "REPROGRAMACION",
      intento: 1,
      decision: "REINTENTO",
      motivo: "AUSENTE",
      fechaProgramada: "2026-05-05T12:00:00.000Z",
      franja: "MAÑANA",
      detalle: "Nuevo intento",
      origenEventId: "evt-1",
    });
    expect(r.ok).toBe(true);
  });

  it("rechaza una alerta con prioridad invalida", () => {
    const r = validarEvento(TOPICS.alertas, {
      ...base,
      tipo: "ALERTA_SLA",
      alertaId: "ALR-1",
      regla: "VENCIDO",
      prioridad: "URGENTE",
      causa: "Vencido",
      estado: "ABIERTA",
      venceEn: "2026-05-04T10:00:00.000Z",
    });
    expect(r.ok).toBe(false);
  });

  it("acepta un evento de DLQ", () => {
    const r = validarEvento(TOPICS.dlq, {
      eventId: "dlq-1",
      tipo: "EVENTO_RECHAZADO",
      ocurridoEn: "2026-05-04T12:00:00.000Z",
      version: 1,
      consumidor: "proyector",
      topic: "envios.estados",
      partition: 0,
      offset: "10",
      motivo: "ESQUEMA_INVALIDO",
      error: "falta tipo",
      original: "{}",
    });
    expect(r.ok).toBe(true);
  });
});
