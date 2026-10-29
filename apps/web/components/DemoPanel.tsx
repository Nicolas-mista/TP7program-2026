"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Badge, EstadoBadge } from "./Badge";
import { fechaHora, numero } from "@/lib/fechas";
import type { DemoStatus } from "@/lib/types";

interface EntradaLog {
  ts: string;
  ok: boolean;
  texto: string;
}

const ESCENARIOS = [
  {
    nombre: "feliz",
    titulo: "Entrega feliz",
    detalle: "Un envio que se entrega en el primer intento, dentro de la promesa.",
  },
  {
    nombre: "ausente",
    titulo: "Destinatario ausente",
    detalle: "Fallo AUSENTE: notificacion al destinatario y reintento al dia habil siguiente.",
  },
  {
    nombre: "demorado",
    titulo: "Demora en el hub",
    detalle: "Promesa de 6 h y el envio no avanza: dispara alertas de SLA.",
  },
  {
    nombre: "tercer-fallo",
    titulo: "Tercer fallo",
    detalle: "Tercer intento fallido: la regla de negocio decide la devolucion.",
  },
  {
    nombre: "rafaga",
    titulo: "Rafaga de 500",
    detalle: "Carga masiva para observar lag, agregados y el comportamiento del pipeline.",
  },
];

const INYECCIONES = [
  {
    tipo: "malformado",
    titulo: "Evento malformado",
    detalle: "Envia un esquema invalido y un JSON roto: ambos terminan en la DLQ.",
  },
  {
    tipo: "duplicado",
    titulo: "Evento duplicado",
    detalle: "Reenvia el ultimo evento con el mismo eventId: los consumidores lo ignoran.",
  },
  {
    tipo: "fuera-de-orden",
    titulo: "Evento fuera de orden",
    detalle: "Reinyecta una secuencia vieja: el proyector la descarta por secuencia.",
  },
];

const GRUPOS = ["proyector", "notificaciones", "reprogramacion", "monitor-sla", "analitica"];

export function DemoPanel({ initial }: { initial: DemoStatus | null }) {
  const [status, setStatus] = useState<DemoStatus | null>(initial);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [log, setLog] = useState<EntradaLog[]>([]);
  const [rate, setRate] = useState<string>("20");

  const registrar = useCallback((texto: string, ok: boolean) => {
    setLog((prev) =>
      [{ ts: new Date().toISOString(), ok, texto }, ...prev].slice(0, 12),
    );
  }, []);

  const cargar = useCallback(async () => {
    try {
      const res = await fetch("/api/demo/status", { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as DemoStatus;
      setStatus(json);
    } catch {
      // el polling se reintenta solo
    }
  }, []);

  useEffect(() => {
    void cargar();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void cargar();
    }, 2_500);
    return () => clearInterval(id);
  }, [cargar]);

  useEffect(() => {
    if (status?.sim) setRate((prev) => (prev === "20" ? String(status.sim!.rate) : prev));
  }, [status?.sim?.rate]);

  const accion = useCallback(
    async (clave: string, url: string, body: unknown, etiqueta: string) => {
      setOcupado(clave);
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body ?? {}),
        });
        const json = await res.json().catch(() => ({}));
        const base = json?.detalle ?? json?.error ?? (res.ok ? "accion ejecutada" : `HTTP ${res.status}`);
        const id = res.ok && typeof json?.shipmentId === "string" ? ` · ${json.shipmentId}` : "";
        registrar(`${etiqueta}: ${base}${id}`, res.ok);
      } catch (error) {
        registrar(`${etiqueta}: ${(error as Error).message}`, false);
      } finally {
        setOcupado(null);
        void cargar();
      }
    },
    [cargar, registrar],
  );

  const sim = status?.sim ?? null;
  const lag = status?.lag ?? [];
  const lagMax = Math.max(0, ...lag.map((l) => l.total));

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Panel de demo</h1>
          <p className="page-sub">
            Escenarios, inyecciones de fallas y control del simulador. Todo pasa por Kafka.
          </p>
        </div>
        <div className="row">
          <span className="pill mono">{sim ? fechaHora(sim.simNow) : "sin reloj"}</span>
          {sim ? (
            <Badge tone={sim.pausado ? "warn" : "ok"}>{sim.pausado ? "pausado" : "corriendo"}</Badge>
          ) : (
            <Badge tone="danger">simulador offline</Badge>
          )}
        </div>
      </div>

      {!sim ? (
        <div className="banner banner-danger" style={{ marginBottom: 14 }}>
          No se pudo contactar al simulador. Verifica que el contenedor <code>simulator</code> este
          arriba (<code>npm run logs</code>).
        </div>
      ) : null}

      <div className="grid grid-4" style={{ marginBottom: 14 }}>
        <div className="kpi">
          <span className="kpi-label">Reloj simulado</span>
          <span className="kpi-value" style={{ fontSize: 20 }}>
            {sim ? fechaHora(sim.simNow) : "-"}
          </span>
          <span className="kpi-hint">
            {sim ? `${sim.speed}x · inicio ${fechaHora(sim.horaInicio)}` : "sin datos"}
          </span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Publicados</span>
          <span className="kpi-value">{numero(sim?.publicados ?? 0)}</span>
          <span className="kpi-hint">eventos desde el arranque</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Envios activos</span>
          <span className="kpi-value">{numero(sim?.enviosActivos ?? 0)}</span>
          <span className="kpi-hint">{numero(sim?.pendientes ?? 0)} reintentos pendientes</span>
        </div>
        <div className={`kpi ${lagMax > 500 ? "tone-danger" : ""}`}>
          <span className="kpi-label">Lag total</span>
          <span className="kpi-value">{numero(lagMax)}</span>
          <span className="kpi-hint">mensajes sin consumir (max entre grupos)</span>
        </div>
      </div>

      <div className="grid grid-main" style={{ marginBottom: 14 }}>
        <div className="stack">
          <section className="card">
            <div className="card-head">
              <span className="card-title">Escenarios de negocio</span>
              <span className="card-hint">publican eventos reales al topic</span>
            </div>
            <div className="grid grid-2">
              {ESCENARIOS.map((e) => (
                <div
                  key={e.nombre}
                  className="card"
                  style={{ padding: 13, background: "var(--panel-2)", boxShadow: "none" }}
                >
                  <div className="between">
                    <strong className="small">{e.titulo}</strong>
                    <button
                      className="btn btn-sm btn-primary"
                      disabled={ocupado !== null}
                      onClick={() => void accion(e.nombre, "/api/demo/scenario", { nombre: e.nombre }, e.titulo)}
                    >
                      {ocupado === e.nombre ? "Creando..." : "Ejecutar"}
                    </button>
                  </div>
                  <p className="tiny muted-2" style={{ marginTop: 6 }}>
                    {e.detalle}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <span className="card-title">Inyecciones de fallas</span>
              <span className="card-hint">garantias del pipeline</span>
            </div>
            <div className="grid grid-3">
              {INYECCIONES.map((i) => (
                <div key={i.tipo} className="stack-sm">
                  <button
                    className="btn"
                    disabled={ocupado !== null}
                    onClick={() => void accion(i.tipo, "/api/demo/inject", { tipo: i.tipo }, i.titulo)}
                  >
                    {ocupado === i.tipo ? "Inyectando..." : i.titulo}
                  </button>
                  <span className="tiny muted-2">{i.detalle}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <span className="card-title">Control del simulador</span>
              <span className="card-hint">el reloj avanza 120x</span>
            </div>
            <div className="toolbar">
              <button
                className="btn"
                disabled={ocupado !== null || !sim}
                onClick={() =>
                  void accion(
                    "pausa",
                    "/api/demo/control",
                    { pausado: !sim?.pausado },
                    sim?.pausado ? "Reanudar" : "Pausar",
                  )
                }
              >
                {sim?.pausado ? "Reanudar simulador" : "Pausar simulador"}
              </button>

              <div className="field">
                <label htmlFor="rate">Envios por minuto simulado</label>
                <input
                  id="rate"
                  type="number"
                  min={1}
                  max={200}
                  value={rate}
                  onChange={(ev) => setRate(ev.target.value)}
                  style={{ width: 110 }}
                />
              </div>
              <button
                className="btn"
                disabled={ocupado !== null || !Number(rate)}
                onClick={() =>
                  void accion("rate", "/api/demo/control", { rate: Number(rate) }, "Cambiar tasa")
                }
              >
                Aplicar tasa
              </button>

              <div className="right">
                <button
                  className="btn btn-danger"
                  disabled={ocupado !== null}
                  onClick={() => {
                    if (
                      window.confirm(
                        "Reset de demo: vacia los topics, reinicia el simulador y reconstruye las vistas. Continuar?",
                      )
                    ) {
                      void accion("reset", "/api/demo/reset", {}, "Reset");
                    }
                  }}
                >
                  {ocupado === "reset" ? "Reiniciando..." : "Reset de demo"}
                </button>
              </div>
            </div>
            <p className="tiny muted-2" style={{ marginTop: 10 }}>
              El reset conserva el contador de envios para no reutilizar IDs que siguen en el log de
              Kafka. Para un borrado total (volumenes incluidos) usa <code>npm run reset</code>.
            </p>
          </section>
        </div>

        <div className="stack">
          <section className="card">
            <div className="card-head">
              <span className="card-title">Lag por grupo</span>
              <span className="card-hint">at-least-once</span>
            </div>
            <div className="stack-sm">
              {GRUPOS.map((grupo) => {
                const fila = lag.find((l) => l.grupo === grupo);
                const total = fila?.total ?? 0;
                return (
                  <div key={grupo} className="between">
                    <span className="mono small">{grupo}</span>
                    <Badge tone={total > 500 ? "danger" : total > 50 ? "warn" : "ok"}>{numero(total)}</Badge>
                  </div>
                );
              })}
            </div>
            <div className="divider" />
            <div className="stack-sm">
              <div className="between">
                <span className="muted-2 small">Envios proyectados</span>
                <span className="mono">
                  {numero(
                    Object.values(status?.proyector?.envios ?? {}).reduce((a, b) => a + b, 0),
                  )}
                </span>
              </div>
              <div className="between">
                <span className="muted-2 small">Alertas abiertas</span>
                <span className="mono">{numero(status?.proyector?.alertasAbiertas ?? 0)}</span>
              </div>
              <div className="between">
                <span className="muted-2 small">Notificaciones</span>
                <span className="mono">{numero(status?.proyector?.notificaciones ?? 0)}</span>
              </div>
              <div className="between">
                <span className="muted-2 small">Metricas diarias</span>
                <span className="mono">{numero(status?.analitica?.metricas ?? 0)}</span>
              </div>
              <div className="between">
                <span className="muted-2 small">Muestras hub a reparto</span>
                <span className="mono">{numero(status?.analitica?.tiemposHub ?? 0)}</span>
              </div>
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <span className="card-title">Replay del cuarto indicador</span>
            </div>
            <p className="tiny muted-2" style={{ marginBottom: 10 }}>
              Lee <code>envios.estados</code> desde el inicio con un grupo nuevo y reconstruye el
              tiempo medio entre ingreso al hub y salida a reparto.
            </p>
            <div className="between">
              <Badge tone={status?.analitica?.replay.activo ? "ok" : "neutral"}>
                {status?.analitica?.replay.activo ? "en curso" : "inactivo"}
              </Badge>
              <span className="mono small">
                {numero(status?.analitica?.replay.procesados ?? 0)} muestras
              </span>
            </div>
            <button
              className="btn btn-primary"
              style={{ marginTop: 10, width: "100%" }}
              disabled={ocupado !== null || Boolean(status?.analitica?.replay.activo)}
              onClick={() => void accion("replay", "/api/demo/replay", {}, "Replay")}
            >
              {ocupado === "replay" ? "Iniciando..." : "Reprocesar historico"}
            </button>
          </section>

          <section className="card">
            <div className="card-head">
              <span className="card-title">Actividad</span>
              <span className="card-hint">ultimas acciones</span>
            </div>
            <div className="list scroll">
              {log.map((l, i) => (
                <div key={`${l.ts}-${i}`} className="list-item" style={{ alignItems: "flex-start" }}>
                  <span className={`badge ${l.ok ? "badge-ok" : "badge-danger"}`}>{l.ok ? "OK" : "ERR"}</span>
                  <div className="grow" style={{ whiteSpace: "normal" }}>
                    <div className="small">{l.texto}</div>
                    <div className="tiny muted-2">{fechaHora(l.ts)}</div>
                  </div>
                </div>
              ))}
              {log.length === 0 ? (
                <div className="empty">Todavia no ejecutaste acciones en esta sesion.</div>
              ) : null}
            </div>
          </section>
        </div>
      </div>

      <section className="card">
        <div className="card-head">
          <span className="card-title">Guia rapida de la demo</span>
          <Link href="/analitica" className="link small">
            Ir a analitica
          </Link>
        </div>
        <div className="grid grid-4">
          <div className="stack-sm">
            <EstadoBadge estado="CREADO" />
            <span className="tiny muted-2">
              1. Ejecuta &quot;Entrega feliz&quot; y abri el detalle desde la torre.
            </span>
          </div>
          <div className="stack-sm">
            <EstadoBadge estado="ENTREGA_FALLIDA" />
            <span className="tiny muted-2">
              2. Ejecuta &quot;Destinatario ausente&quot;: mira la notificacion y la reprogramacion.
            </span>
          </div>
          <div className="stack-sm">
            <EstadoBadge estado="EN_REPARTO" />
            <span className="tiny muted-2">
              3. Ejecuta &quot;Demora en el hub&quot;: la alerta SLA aparece en la torre.
            </span>
          </div>
          <div className="stack-sm">
            <span className="badge badge-danger">DLQ</span>
            <span className="tiny muted-2">
              4. Inyecta un evento malformado y revisa la DLQ en los logs.
            </span>
          </div>
        </div>
      </section>
    </>
  );
}
