#!/usr/bin/env node
/**
 * Reset total: baja los contenedores, borra los volumenes (Kafka + Mongo) y
 * vuelve a levantar todo. Es la forma de empezar la demo desde cero.
 */
import { spawnSync } from "node:child_process";

function correr(comando) {
  console.log(`\n$ ${comando}`);
  const r = spawnSync(comando, { shell: true, stdio: "inherit", env: process.env });
  if (r.status !== 0) {
    console.error(`Fallo: ${comando}`);
    process.exit(r.status ?? 1);
  }
}

correr("docker compose down -v --remove-orphans");
correr("docker compose up -d --build");

console.log("\nStack reiniciado. La torre esta en http://localhost:3000");
console.log("Los servicios tardan unos segundos en conectar; segui el arranque con:");
console.log("  npm run logs");
