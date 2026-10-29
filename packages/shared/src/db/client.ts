import { MongoClient, type Db, type ClientSession } from "mongodb";
import { getMongoDbName, getMongoUri } from "../config";

let cliente: MongoClient | null = null;
let base: Db | null = null;

export async function conectarDb(intentos = 30, esperaMs = 2000): Promise<Db> {
  if (base) return base;
  let ultimoError: unknown;
  for (let i = 1; i <= intentos; i += 1) {
    try {
      const c = new MongoClient(getMongoUri(), { serverSelectionTimeoutMS: 5000 });
      await c.connect();
      await c.db(getMongoDbName()).command({ ping: 1 });
      cliente = c;
      base = c.db(getMongoDbName());
      return base;
    } catch (error) {
      ultimoError = error;
      // eslint-disable-next-line no-console
      console.warn(`[mongo] intento ${i}/${intentos} fallido: ${(error as Error).message}`);
      await new Promise((r) => setTimeout(r, esperaMs));
    }
  }
  throw new Error(`No se pudo conectar a MongoDB: ${String(ultimoError)}`);
}

export function db(): Db {
  if (!base) throw new Error("MongoDB no inicializado: llamar a conectarDb() primero");
  return base;
}

export function mongoClient(): MongoClient {
  if (!cliente) throw new Error("MongoDB no inicializado");
  return cliente;
}

export async function cerrarDb(): Promise<void> {
  await cliente?.close();
  cliente = null;
  base = null;
}

export type { ClientSession };
