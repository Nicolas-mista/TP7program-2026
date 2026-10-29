import { getSimTz } from "../config";
import type { Franja } from "../events/types";

let cacheTz = "";
let cacheFmt: Intl.DateTimeFormat | null = null;

function formateador(): Intl.DateTimeFormat {
  const tz = getSimTz();
  if (cacheFmt && cacheTz === tz) return cacheFmt;
  cacheTz = tz;
  cacheFmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  return cacheFmt;
}

export interface PartesFecha {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function partesTz(fecha: Date): PartesFecha {
  const partes = formateador().formatToParts(fecha);
  const valor = (tipo: Intl.DateTimeFormatPartTypes): number =>
    Number(partes.find((p) => p.type === tipo)?.value ?? "0");
  return {
    year: valor("year"),
    month: valor("month"),
    day: valor("day"),
    hour: valor("hour"),
    minute: valor("minute"),
    second: valor("second"),
  };
}

const pad = (n: number): string => String(n).padStart(2, "0");

/** Fecha calendario (YYYY-MM-DD) en la zona horaria del simulador. */
export function fechaTz(fecha: Date): string {
  const p = partesTz(fecha);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function horaTz(fecha: Date): number {
  return partesTz(fecha).hour;
}

/**
 * Franjas del caso: MAÑANA 08-12, TARDE 13-17, NOCHE 18-07.
 * La madrugada se considera NOCHE para no crear una cuarta franja.
 */
export function franjaDe(fecha: Date): Franja {
  const hora = horaTz(fecha);
  if (hora >= 8 && hora < 13) return "MAÑANA";
  if (hora >= 13 && hora < 18) return "TARDE";
  return "NOCHE";
}

export const HORA_INICIO_FRANJA: Record<Franja, number> = {
  MAÑANA: 9,
  TARDE: 14,
  NOCHE: 19,
};

export function franjaOpuesta(franja: Franja): Franja {
  if (franja === "MAÑANA") return "TARDE";
  if (franja === "TARDE") return "MAÑANA";
  return "MAÑANA";
}

function anclaUtcNoon(fecha: Date): Date {
  const p = partesTz(fecha);
  return new Date(Date.UTC(p.year, p.month - 1, p.day, 12, 0, 0));
}

/** Siguiente dia habil (lunes a viernes) a partir de la fecha indicada. */
export function siguienteDiaHabil(fecha: Date): Date {
  const ancla = anclaUtcNoon(fecha);
  for (let i = 0; i < 10; i += 1) {
    ancla.setUTCDate(ancla.getUTCDate() + 1);
    const dow = ancla.getUTCDay();
    if (dow !== 0 && dow !== 6) return new Date(ancla);
  }
  return new Date(ancla);
}

/**
 * Fecha concreta del proximo intento: siguiente dia habil a la hora de inicio
 * de la franja elegida. Argentina no aplica horario de verano (UTC-3 fijo).
 */
export function fechaProgramada(fechaFallo: Date, franja: Franja): Date {
  const dia = siguienteDiaHabil(fechaFallo);
  const ymd = `${dia.getUTCFullYear()}-${pad(dia.getUTCMonth() + 1)}-${pad(dia.getUTCDate())}`;
  return new Date(`${ymd}T${pad(HORA_INICIO_FRANJA[franja])}:00:00-03:00`);
}

export function esMismoDiaTz(a: Date, b: Date): boolean {
  return fechaTz(a) === fechaTz(b);
}

export function minutosEntre(desde: Date, hasta: Date): number {
  return Math.round(((hasta.getTime() - desde.getTime()) / 60000) * 10) / 10;
}

export function fechaHoraLegible(fecha: Date): string {
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: getSimTz(),
    dateStyle: "short",
    timeStyle: "short",
  }).format(fecha);
}

export function sumarHoras(fecha: Date, horas: number): Date {
  return new Date(fecha.getTime() + horas * 60 * 60 * 1000);
}

export function sumarMinutos(fecha: Date, minutos: number): Date {
  return new Date(fecha.getTime() + minutos * 60 * 1000);
}
