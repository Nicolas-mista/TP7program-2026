import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

let cargado = false;

/**
 * Busca el .env en el directorio actual y hasta tres niveles hacia arriba.
 * Permite correr los servicios tanto desde la raiz como desde su carpeta.
 */
export function loadEnv(): void {
  if (cargado) return;
  cargado = true;
  let dir = process.cwd();
  for (let i = 0; i < 4; i += 1) {
    const candidato = join(dir, ".env");
    if (existsSync(candidato)) {
      loadDotenv({ path: candidato, override: false, quiet: true });
      return;
    }
    const padre = dirname(dir);
    if (padre === dir) return;
    dir = padre;
  }
}

loadEnv();

export function env(nombre: string, porDefecto?: string): string {
  const valor = process.env[nombre] ?? porDefecto;
  if (valor === undefined) {
    throw new Error(`Falta la variable de entorno ${nombre}`);
  }
  return valor;
}

export function numEnv(nombre: string, porDefecto: number): number {
  const raw = process.env[nombre];
  if (raw === undefined || raw.trim() === "") return porDefecto;
  const valor = Number(raw);
  return Number.isFinite(valor) ? valor : porDefecto;
}

export function boolEnv(nombre: string, porDefecto = false): boolean {
  const raw = process.env[nombre];
  if (raw === undefined) return porDefecto;
  return ["1", "true", "yes", "si"].includes(raw.toLowerCase());
}

export function getKafkaBrokers(): string[] {
  return env("KAFKA_BROKERS", "localhost:9092")
    .split(",")
    .map((b) => b.trim())
    .filter(Boolean);
}

export function getMongoUri(): string {
  return env("MONGO_URI", "mongodb://localhost:27017/rutasur?directConnection=true");
}

export function getMongoDbName(): string {
  return env("MONGO_DB", "rutasur");
}

export function getSimSpeed(): number {
  return numEnv("SIM_SPEED", 120);
}

export function getSimRate(): number {
  return numEnv("SIM_RATE", 20);
}

export function getSimSeed(): number {
  return numEnv("SIM_SEED", 42);
}

export function getSimTz(): string {
  return env("SIM_TZ", "America/Argentina/Buenos_Aires");
}
