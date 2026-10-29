import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Ajv, { type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { TOPICS } from "../topics";

const ARCHIVOS: Record<string, string> = {
  [TOPICS.estados]: "estado.json",
  [TOPICS.promesas]: "promesa.json",
  [TOPICS.reprogramaciones]: "reprogramacion.json",
  [TOPICS.alertas]: "alerta-sla.json",
  [TOPICS.notificaciones]: "notificacion.json",
  [TOPICS.dlq]: "dlq.json",
};

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

const validadores = new Map<string, ValidateFunction>();

function cargar(topic: string): ValidateFunction | null {
  const cacheado = validadores.get(topic);
  if (cacheado) return cacheado;
  const archivo = ARCHIVOS[topic];
  if (!archivo) return null;
  const url = new URL(`./schemas/${archivo}`, import.meta.url);
  const schema = JSON.parse(readFileSync(fileURLToPath(url), "utf8"));
  const validador = ajv.compile(schema);
  validadores.set(topic, validador);
  return validador;
}

export interface ResultadoValidacion {
  ok: boolean;
  errores: string[];
}

export function validarEvento(topic: string, payload: unknown): ResultadoValidacion {
  const validador = cargar(topic);
  if (!validador) return { ok: true, errores: [] };
  const ok = validador(payload) as boolean;
  if (ok) return { ok: true, errores: [] };
  const errores = (validador.errors ?? []).map(
    (e) => `${e.instancePath || "/"} ${e.message ?? "invalido"}`,
  );
  return { ok: false, errores };
}

/** Valida el evento de DLQ contra su propio esquema (usado por el revisor manual). */
export function validarEventoDlq(payload: unknown): ResultadoValidacion {
  return validarEvento(TOPICS.dlq, payload);
}
