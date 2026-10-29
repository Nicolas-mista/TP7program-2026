import { MongoClient, type Db } from "mongodb";

const uri = process.env.MONGO_URI ?? "mongodb://localhost:27017/rutasur?directConnection=true";
const nombre = process.env.MONGO_DB ?? "rutasur";

const global = globalThis as unknown as { __rutasurMongo?: Promise<MongoClient> };

export function getMongo(): Promise<MongoClient> {
  if (!global.__rutasurMongo) {
    const cliente = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
    global.__rutasurMongo = cliente.connect().catch((error) => {
      global.__rutasurMongo = undefined;
      throw error;
    });
  }
  return global.__rutasurMongo;
}

export async function getDb(): Promise<Db> {
  const cliente = await getMongo();
  return cliente.db(nombre);
}
