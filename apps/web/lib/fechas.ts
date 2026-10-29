const TZ = "America/Argentina/Buenos_Aires";

const fechaHoraFmt = new Intl.DateTimeFormat("es-AR", {
  timeZone: TZ,
  dateStyle: "short",
  timeStyle: "medium",
});

const fechaFmt = new Intl.DateTimeFormat("es-AR", {
  timeZone: TZ,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const horaFmt = new Intl.DateTimeFormat("es-AR", {
  timeZone: TZ,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function fechaHora(valor: string | Date | null | undefined): string {
  if (!valor) return "-";
  const fecha = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(fecha.getTime())) return "-";
  return fechaHoraFmt.format(fecha);
}

export function fechaCorta(valor: string | Date | null | undefined): string {
  if (!valor) return "-";
  const fecha = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(fecha.getTime())) return "-";
  return fechaFmt.format(fecha);
}

export function horaCorta(valor: string | Date | null | undefined): string {
  if (!valor) return "-";
  const fecha = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(fecha.getTime())) return "-";
  return horaFmt.format(fecha);
}

export function fechaISO(valor: Date | string): string {
  return valor instanceof Date ? valor.toISOString() : new Date(valor).toISOString();
}

export function hoyISO(): string {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return partes;
}

export function haceDias(dias: number): string {
  return new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function porcentaje(numerador: number, denominador: number): number {
  if (!denominador) return 0;
  return Math.round((numerador / denominador) * 1000) / 10;
}

export function numero(valor: number | null | undefined): string {
  return new Intl.NumberFormat("es-AR").format(valor ?? 0);
}

export function minutos(valor: number | null | undefined): string {
  if (valor === null || valor === undefined) return "-";
  if (valor < 60) return `${Math.round(valor)} min`;
  const horas = Math.floor(valor / 60);
  const resto = Math.round(valor % 60);
  return `${horas} h ${resto} min`;
}
