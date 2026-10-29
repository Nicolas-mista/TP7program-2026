import { createHash, randomUUID } from "node:crypto";

/** Identificador aleatorio para eventos de origen. */
export function nuevoId(prefijo = "evt"): string {
  return `${prefijo}-${randomUUID()}`;
}

/**
 * Identificador determinístico: dos ejecuciones del mismo evento producen
 * el mismo id, lo que permite que los consumidores sean idempotentes.
 */
export function idDeterministico(...partes: Array<string | number>): string {
  const hash = createHash("sha1").update(partes.join("|")).digest("hex");
  return hash.slice(0, 24);
}

export function idAlerta(shipmentId: string, regla: string): string {
  return `ALR-${idDeterministico(shipmentId, regla)}`;
}

export function idNotificacion(shipmentId: string, origenEventId: string): string {
  return `NTF-${idDeterministico(shipmentId, origenEventId)}`;
}
