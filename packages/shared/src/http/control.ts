import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Logger } from "pino";

export interface RutaControl {
  method: "GET" | "POST";
  path: string;
  handler: (body: any, req: IncomingMessage) => Promise<{ status?: number; body: unknown }>;
}

function leerBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 2_000_000) {
        reject(new Error("body demasiado grande"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error("JSON invalido"));
      }
    });
    req.on("error", reject);
  });
}

function responder(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

/**
 * Servidor HTTP minimo de operacion (health, rebuild y acciones de demo).
 * No se usa para comunicacion entre servicios: eso viaja por Kafka.
 */
export function iniciarControl(
  servicio: string,
  puerto: number,
  rutas: RutaControl[],
  logger: Logger,
): Server {
  const server = createServer(async (req, res) => {
    if (req.method === "OPTIONS") {
      responder(res, 204, {});
      return;
    }
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "GET" && (url.pathname === "/health" || url.pathname === "/")) {
      responder(res, 200, { ok: true, servicio, ts: new Date().toISOString() });
      return;
    }
    const ruta = rutas.find((r) => r.method === req.method && r.path === url.pathname);
    if (!ruta) {
      responder(res, 404, { ok: false, error: `ruta no encontrada: ${req.method} ${url.pathname}` });
      return;
    }
    try {
      const body = req.method === "POST" ? await leerBody(req) : {};
      const resultado = await ruta.handler(body, req);
      responder(res, resultado.status ?? 200, resultado.body);
    } catch (error) {
      logger.error({ error: (error as Error).message, ruta: url.pathname }, "error en control");
      responder(res, 500, { ok: false, error: (error as Error).message });
    }
  });

  server.listen(puerto, () => {
    logger.info({ puerto, servicio }, "servidor de control escuchando");
  });
  return server;
}
