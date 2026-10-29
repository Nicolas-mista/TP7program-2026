import type { EstadoTipo, Prioridad, ReglaSla } from "../events/types";
import { esMismoDiaTz } from "./franjas";

export const PRIORIDAD_POR_REGLA: Record<ReglaSla, Prioridad> = {
  SIN_INGRESO: "MEDIA",
  SIN_SALIDA: "ALTA",
  FALLO_EN_DIA_LIMITE: "ALTA",
  VENCIDO: "CRITICA",
};

export const ORDEN_PRIORIDAD: Record<Prioridad, number> = {
  CRITICA: 0,
  ALTA: 1,
  MEDIA: 2,
};

export const DESCRIPCION_REGLA: Record<ReglaSla, string> = {
  SIN_INGRESO: "Faltan menos de 10 h y el envio no ingreso al hub",
  SIN_SALIDA: "Faltan menos de 4 h y el envio no esta en reparto",
  FALLO_EN_DIA_LIMITE: "Entrega fallida y la promesa vence hoy",
  VENCIDO: "Paso el vencimiento sin ENTREGADO",
};

const ESTADOS_SIN_SALIDA: EstadoTipo[] = ["CREADO", "INGRESADO_HUB", "CLASIFICADO"];

export interface EntradaEvaluacionSla {
  estado: EstadoTipo;
  venceEn: Date | null;
  ahora: Date;
  reglasDisparadas: ReglaSla[];
}

/**
 * Devuelve las reglas que corresponden disparar en este momento, sin repetir
 * las que ya se dispararon para el mismo envio.
 */
export function evaluarSla(entrada: EntradaEvaluacionSla): ReglaSla[] {
  const { estado, venceEn, ahora, reglasDisparadas } = entrada;
  if (!venceEn) return [];
  if (estado === "ENTREGADO") return [];

  const faltanMs = venceEn.getTime() - ahora.getTime();
  const faltanHoras = faltanMs / 3_600_000;
  const reglas: ReglaSla[] = [];

  if (faltanMs < 0) {
    reglas.push("VENCIDO");
  }
  if (estado === "CREADO" && faltanMs > 0 && faltanHoras < 10) {
    reglas.push("SIN_INGRESO");
  }
  if (ESTADOS_SIN_SALIDA.includes(estado) && faltanMs > 0 && faltanHoras < 4) {
    reglas.push("SIN_SALIDA");
  }
  if (estado === "ENTREGA_FALLIDA" && esMismoDiaTz(venceEn, ahora)) {
    reglas.push("FALLO_EN_DIA_LIMITE");
  }

  return reglas
    .filter((r) => !reglasDisparadas.includes(r))
    .sort((a, b) => ORDEN_PRIORIDAD[PRIORIDAD_POR_REGLA[a]] - ORDEN_PRIORIDAD[PRIORIDAD_POR_REGLA[b]]);
}

export function causaAlerta(regla: ReglaSla, venceEn: Date, ahora: Date): string {
  const horas = Math.round(((venceEn.getTime() - ahora.getTime()) / 3_600_000) * 10) / 10;
  switch (regla) {
    case "SIN_INGRESO":
      return `Sin ingreso al hub y vence en ${horas} h`;
    case "SIN_SALIDA":
      return `Sin salida a reparto y vence en ${horas} h`;
    case "FALLO_EN_DIA_LIMITE":
      return "Entrega fallida el mismo dia del vencimiento";
    case "VENCIDO":
      return `Vencido hace ${Math.abs(horas)} h`;
    default:
      return DESCRIPCION_REGLA[regla];
  }
}
