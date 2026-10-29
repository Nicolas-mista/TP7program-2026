import type { MotivoFallo } from "@rutasur/shared";
import type { Rng } from "./rng";

export interface Zona {
  zonaId: string;
  hubId: string;
  tasaFallo: number;
}

/** Tres centros de distribucion, seis zonas con tasas de fallo distintas. */
export const ZONAS: Zona[] = [
  { zonaId: "Z-01", hubId: "HUB-CEN", tasaFallo: 0.05 },
  { zonaId: "Z-02", hubId: "HUB-CEN", tasaFallo: 0.1 },
  { zonaId: "Z-03", hubId: "HUB-NOR", tasaFallo: 0.16 },
  { zonaId: "Z-04", hubId: "HUB-NOR", tasaFallo: 0.22 },
  { zonaId: "Z-05", hubId: "HUB-SUR", tasaFallo: 0.27 },
  { zonaId: "Z-06", hubId: "HUB-SUR", tasaFallo: 0.3 },
];

export function zonaPorId(zonaId: string | null): Zona | undefined {
  return ZONAS.find((z) => z.zonaId === zonaId);
}

/** 60% ausente, 20% direccion, 15% rechazo, 5% zona inaccesible. */
export function elegirMotivo(rng: Rng): MotivoFallo {
  const r = rng.next();
  if (r < 0.6) return "AUSENTE";
  if (r < 0.8) return "DIRECCION_INCORRECTA";
  if (r < 0.95) return "RECHAZADO";
  return "ZONA_INACCESIBLE";
}

export function repartidor(rng: Rng): string {
  return `R-${String(rng.int(1, 120)).padStart(3, "0")}`;
}
