import { describe, expect, it } from "vitest";
import { decidirReprogramacion } from "./reprogramacion";
import { evaluarSla, PRIORIDAD_POR_REGLA } from "./sla";
import { fechaTz, franjaDe, fechaProgramada } from "./franjas";

describe("franjas y calendario", () => {
  it("calcula la franja segun la hora de Argentina", () => {
    expect(franjaDe(new Date("2026-05-04T12:00:00-03:00"))).toBe("MAÑANA");
    expect(franjaDe(new Date("2026-05-04T15:00:00-03:00"))).toBe("TARDE");
    expect(franjaDe(new Date("2026-05-04T20:00:00-03:00"))).toBe("NOCHE");
    expect(franjaDe(new Date("2026-05-04T02:00:00-03:00"))).toBe("NOCHE");
  });

  it("usa la fecha calendario de Argentina, no UTC", () => {
    // 23:30 en Argentina ya es el dia siguiente en UTC.
    expect(fechaTz(new Date("2026-05-04T23:30:00-03:00"))).toBe("2026-05-04");
    expect(fechaTz(new Date("2026-05-05T02:30:00-03:00"))).toBe("2026-05-05");
  });

  it("salta el fin de semana al programar", () => {
    // Viernes 8/5 a la noche -> lunes 11/5 a las 09:00.
    const fecha = fechaProgramada(new Date("2026-05-08T20:00:00-03:00"), "MAÑANA");
    expect(fecha.toISOString()).toBe("2026-05-11T12:00:00.000Z");
  });
});

describe("reglas de reprogramacion", () => {
  const lunesTarde = new Date("2026-05-04T15:00:00-03:00");

  it("AUSENTE reprograma al dia habil siguiente en la franja opuesta", () => {
    const d = decidirReprogramacion("AUSENTE", 1, lunesTarde);
    expect(d.decision).toBe("REINTENTO");
    expect(d.franja).toBe("MAÑANA");
    expect(d.fechaProgramada?.toISOString()).toBe("2026-05-05T12:00:00.000Z");
  });

  it("DIRECCION_INCORRECTA queda retenido", () => {
    expect(decidirReprogramacion("DIRECCION_INCORRECTA", 1, lunesTarde).decision).toBe("RETENIDO");
  });

  it("RECHAZADO vuelve al comercio", () => {
    expect(decidirReprogramacion("RECHAZADO", 1, lunesTarde).decision).toBe("DEVOLUCION");
  });

  it("el tercer fallo siempre devuelve, sea cual sea el motivo", () => {
    for (const motivo of ["AUSENTE", "DIRECCION_INCORRECTA", "RECHAZADO", "ZONA_INACCESIBLE"] as const) {
      expect(decidirReprogramacion(motivo, 3, lunesTarde).decision).toBe("DEVOLUCION");
    }
  });
});

describe("reglas de SLA", () => {
  const ahora = new Date("2026-05-04T10:00:00-03:00");

  it("dispara SIN_INGRESO con menos de 10 h y estado CREADO", () => {
    const reglas = evaluarSla({
      estado: "CREADO",
      venceEn: new Date("2026-05-04T19:00:00-03:00"),
      ahora,
      reglasDisparadas: [],
    });
    expect(reglas).toContain("SIN_INGRESO");
    expect(PRIORIDAD_POR_REGLA.SIN_INGRESO).toBe("MEDIA");
  });

  it("dispara SIN_SALIDA con menos de 4 h y sin reparto", () => {
    const reglas = evaluarSla({
      estado: "CLASIFICADO",
      venceEn: new Date("2026-05-04T13:00:00-03:00"),
      ahora,
      reglasDisparadas: [],
    });
    expect(reglas).toContain("SIN_SALIDA");
    expect(PRIORIDAD_POR_REGLA.SIN_SALIDA).toBe("ALTA");
  });

  it("dispara FALLO_EN_DIA_LIMITE el mismo dia del vencimiento", () => {
    const reglas = evaluarSla({
      estado: "ENTREGA_FALLIDA",
      venceEn: new Date("2026-05-04T21:00:00-03:00"),
      ahora,
      reglasDisparadas: [],
    });
    expect(reglas).toContain("FALLO_EN_DIA_LIMITE");
  });

  it("dispara VENCIDO con prioridad critica", () => {
    const reglas = evaluarSla({
      estado: "EN_REPARTO",
      venceEn: new Date("2026-05-04T09:00:00-03:00"),
      ahora,
      reglasDisparadas: [],
    });
    expect(reglas).toContain("VENCIDO");
    expect(PRIORIDAD_POR_REGLA.VENCIDO).toBe("CRITICA");
  });

  it("no repite una regla ya disparada", () => {
    const reglas = evaluarSla({
      estado: "CREADO",
      venceEn: new Date("2026-05-04T19:00:00-03:00"),
      ahora,
      reglasDisparadas: ["SIN_INGRESO"],
    });
    expect(reglas).not.toContain("SIN_INGRESO");
  });

  it("no alerta envios entregados", () => {
    const reglas = evaluarSla({
      estado: "ENTREGADO",
      venceEn: new Date("2026-05-04T09:00:00-03:00"),
      ahora,
      reglasDisparadas: [],
    });
    expect(reglas).toHaveLength(0);
  });
});
