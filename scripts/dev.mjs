#!/usr/bin/env node
/**
 * Modo desarrollo local: levanta Kafka + MongoDB en Docker y despues corre los
 * seis servicios y la web con recarga en caliente (tsx watch / next dev).
 *
 * Uso:
 *   npm run dev              # levanta la infra y los 7 procesos
 *   npm run dev -- --no-infra  # solo los procesos (infra ya levantada)
 */
import { spawn, spawnSync } from "node:child_process";
import net from "node:net";

const argumentos = new Set(process.argv.slice(2));
const conInfra = !argumentos.has("--no-infra");
const RESET = "\x1b[0m";

const SERVICIOS = [
  { nombre: "simulador", color: "\x1b[36m", comando: "npx tsx watch services/simulator/src/index.ts" },
  { nombre: "proyector", color: "\x1b[34m", comando: "npx tsx watch services/projector/src/index.ts" },
  { nombre: "notifica", color: "\x1b[35m", comando: "npx tsx watch services/notifications/src/index.ts" },
  { nombre: "reprog", color: "\x1b[33m", comando: "npx tsx watch services/rescheduler/src/index.ts" },
  { nombre: "sla", color: "\x1b[31m", comando: "npx tsx watch services/sla-monitor/src/index.ts" },
  { nombre: "analitica", color: "\x1b[32m", comando: "npx tsx watch services/analytics/src/index.ts" },
  { nombre: "web", color: "\x1b[96m", comando: "npm run dev -w @rutasur/web" },
];

function correr(comando) {
  return spawnSync(comando, { shell: true, stdio: "inherit", env: process.env });
}

function esperarTcp(host, puerto, timeoutMs, etiqueta) {
  const inicio = Date.now();
  return new Promise((resolve, reject) => {
    const intentar = () => {
      const socket = net.connect({ host, port: puerto });
      socket.setTimeout(1500);
      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });
      const fallar = () => {
        socket.destroy();
        if (Date.now() - inicio > timeoutMs) {
          reject(new Error(`timeout esperando ${etiqueta} en ${host}:${puerto}`));
          return;
        }
        setTimeout(intentar, 1000);
      };
      socket.once("error", fallar);
      socket.once("timeout", fallar);
    };
    intentar();
  });
}

function prefijar(stream, nombre, color) {
  let buffer = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    buffer += chunk;
    let corte = buffer.indexOf("\n");
    while (corte >= 0) {
      const linea = buffer.slice(0, corte).replace(/\r$/, "");
      buffer = buffer.slice(corte + 1);
      if (linea.trim()) process.stdout.write(`${color}[${nombre}]${RESET} ${linea}\n`);
      corte = buffer.indexOf("\n");
    }
  });
}

const hijos = [];

function terminar(codigo = 0) {
  for (const hijo of hijos) {
    if (!hijo.pid || hijo.exitCode !== null) continue;
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(hijo.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      hijo.kill("SIGTERM");
    }
  }
  process.exit(codigo);
}

async function main() {
  if (conInfra) {
    console.log("Levantando Kafka y MongoDB con docker compose...");
    const up = correr("docker compose up -d kafka mongo kafka-init mongo-init");
    if (up.status !== 0) {
      console.error(
        "\nNo se pudo levantar la infraestructura. Verifica que Docker Desktop este corriendo.",
      );
      process.exit(1);
    }
    try {
      await esperarTcp("127.0.0.1", 9092, 120_000, "Kafka");
      console.log("Kafka responde en localhost:9092");
      await esperarTcp("127.0.0.1", 27017, 90_000, "MongoDB");
      console.log("MongoDB responde en localhost:27017");
    } catch (error) {
      console.error(`\n${error.message}`);
      console.error("Revisa los logs con: docker compose logs kafka mongo mongo-init");
      process.exit(1);
    }
  }

  console.log("\nArrancando servicios (Ctrl+C para detener todo):");
  console.log("  torre      http://localhost:3000");
  console.log("  demo       http://localhost:3000/demo");
  console.log("  simulador  http://localhost:4000/status\n");

  for (const servicio of SERVICIOS) {
    const hijo = spawn(servicio.comando, {
      shell: true,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    prefijar(hijo.stdout, servicio.nombre, servicio.color);
    prefijar(hijo.stderr, servicio.nombre, servicio.color);
    hijo.on("exit", (codigo) => {
      console.log(`${servicio.color}[${servicio.nombre}]${RESET} termino con codigo ${codigo}`);
    });
    hijos.push(hijo);
  }
}

process.on("SIGINT", () => terminar(0));
process.on("SIGTERM", () => terminar(0));

main().catch((error) => {
  console.error(error);
  terminar(1);
});
