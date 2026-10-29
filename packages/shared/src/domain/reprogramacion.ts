import type { Decision, EstadoTipo, Franja, MotivoFallo } from "../events/types";
import { fechaProgramada, franjaDe, franjaOpuesta } from "./franjas";

export interface DecisionReprogramacion {
  decision: Decision;
  motivo: MotivoFallo;
  fechaProgramada: Date | null;
  franja: Franja | null;
  detalle: string;
}

/**
 * Reglas de negocio del CU2. Es una funcion pura: el servicio solo la invoca
 * y publica el resultado.
 */
export function decidirReprogramacion(
  motivo: MotivoFallo,
  intento: number,
  ocurridoEn: Date,
): DecisionReprogramacion {
  if (intento >= 3) {
    return {
      decision: "DEVOLUCION",
      motivo,
      fechaProgramada: null,
      franja: null,
      detalle: "Tercer intento fallido: se devuelve al comercio",
    };
  }

  switch (motivo) {
    case "AUSENTE": {
      const franja = franjaOpuesta(franjaDe(ocurridoEn));
      return {
        decision: "REINTENTO",
        motivo,
        fechaProgramada: fechaProgramada(ocurridoEn, franja),
        franja,
        detalle: `Nuevo intento el proximo dia habil en la franja ${franja}`,
      };
    }
    case "DIRECCION_INCORRECTA":
      return {
        decision: "RETENIDO",
        motivo,
        fechaProgramada: null,
        franja: null,
        detalle: "Retenido hasta que el comercio corrija la direccion",
      };
    case "RECHAZADO":
      return {
        decision: "DEVOLUCION",
        motivo,
        fechaProgramada: null,
        franja: null,
        detalle: "El destinatario rechazo el envio: vuelve al comercio",
      };
    case "ZONA_INACCESIBLE":
    default:
      return {
        decision: "RETENIDO",
        motivo,
        fechaProgramada: null,
        franja: null,
        detalle: "Zona inaccesible: requiere coordinacion antes de reintentar",
      };
  }
}

/** Estados que cierran el circuito de un envio. */
export function esEstadoFinal(estado: EstadoTipo): boolean {
  return estado === "ENTREGADO" || estado === "ENTREGA_FALLIDA";
}
