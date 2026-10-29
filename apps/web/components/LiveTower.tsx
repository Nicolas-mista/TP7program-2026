"use client";

import Link from "next/link";
import { EstadoBadge, PrioridadBadge } from "./Badge";
import { StatCard } from "./StatCard";
import { useLive } from "./useLive";
import { fechaHora, horaCorta, numero } from "@/lib/fechas";
import type { TowerSnapshot } from "@/lib/types";

const COLOR: Record<string, string> = {
  CREADO: "#94a3b8",
  INGRESADO_HUB: "#38bdf8",
  CLASIFICADO: "#818cf8",
  EN_REPARTO: "#fbbf24",
  ENTREGADO: "#34d399",
  ENTREGA_FALLIDA: "#f87171",
};

const ORDEN = [
  "CREADO",
  "INGRESADO_HUB",
  "CLASIFICADO",
  "EN_REPARTO",
  "ENTREGADO",
  "ENTREGA_FALLIDA",
];

export function LiveTower({ initial }: { initial: TowerSnapshot }) {
  const { data, live } = useLive<TowerSnapshot>("tower", undefined, initial);

  const enReparto = data.counts.EN_REPARTO ?? 0;
  const entregados = data.counts.ENTREGADO ?? 0;
  const fallidos = data.counts.ENTREGA_FALLIDA ?? 0;
  const enCurso = ORDEN.slice(0, 4).reduce((acc, e) => acc + (data.counts[e] ?? 0), 0);
  const maxBarra = Math.max(1, data.total);

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Torre de control</h1>
          <p className="page-sub">
            Estado en vivo de todos los envios, proyectado desde los eventos de Kafka.
          </p>
        </div>
        <div className="row">
          <span className={`live ${live ? "on" : ""}`}>
            <span className="live-dot" />
            {live ? "en vivo" : "reconectando"}
          </span>
          <span className="pill mono">{horaCorta(data.actualizadoEn)}</span>
        </div>
      </div>

      <div className="grid grid-5" style={{ marginBottom: 14 }}>
        <StatCard label="Envios" value={numero(data.total)} hint="total proyectado" tone="accent" />
        <StatCard label="En curso" value={numero(enCurso)} hint="creado a en reparto" />
        <StatCard label="En reparto" value={numero(enReparto)} hint="ultima milla" tone="warn" />
        <StatCard label="Entregados" value={numero(entregados)} hint="promesa cumplida" tone="ok" />
        <StatCard
          label="Alertas SLA"
          value={numero(data.alertas.length)}
          hint="abiertas por prioridad"
          tone={data.alertas.length > 0 ? "danger" : "ok"}
        />
      </div>

      <div className="grid grid-main">
        <div className="stack">
          <section className="card">
            <div className="card-head">
              <span className="card-title">Flujo de envios</span>
              <span className="card-hint">{numero(data.total)} envios · {numero(fallidos)} fallidos</span>
            </div>

            <div className="stacked" role="img" aria-label="Distribucion de envios por estado">
              {ORDEN.map((estado) => {
                const total = data.counts[estado] ?? 0;
                if (total === 0) return null;
                return (
                  <span
                    key={estado}
                    title={`${estado}: ${total}`}
                    style={{ width: `${(total / maxBarra) * 100}%`, background: COLOR[estado] }}
                  />
                );
              })}
            </div>

            <div className="legend">
              {ORDEN.map((estado) => (
                <span key={estado} className="legend-item">
                  <span className="swatch" style={{ background: COLOR[estado] }} />
                  {estado.replace(/_/g, " ").toLowerCase()}
                  <strong style={{ color: "var(--text)" }}>{numero(data.counts[estado] ?? 0)}</strong>
                </span>
              ))}
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <span className="card-title">Ultimos movimientos</span>
              <Link href="/analitica" className="link small">
                Ver analitica
              </Link>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Envio</th>
                    <th>Estado</th>
                    <th>Zona</th>
                    <th className="num">Intento</th>
                    <th>Ultimo evento</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recientes.map((r) => (
                    <tr key={r.shipmentId}>
                      <td>
                        <Link href={`/envios/${r.shipmentId}`} className="mono link">
                          {r.shipmentId}
                        </Link>
                      </td>
                      <td>
                        <EstadoBadge estado={r.estado} />
                      </td>
                      <td className="mono">{r.zonaId ?? "-"}</td>
                      <td className="num">{r.intento}</td>
                      <td className="muted-2 small">{fechaHora(r.ultimoEventoEn)}</td>
                    </tr>
                  ))}
                  {data.recientes.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="empty">
                        Todavia no hay envios proyectados. Crea un escenario en la pestana Demo.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <section className="card" style={{ display: "flex", flexDirection: "column" }}>
          <div className="card-head">
            <span className="card-title">Alertas de SLA abiertas</span>
            <span className="card-hint">criticas primero</span>
          </div>
          <div className="list scroll-tall">
            {data.alertas.map((a) => (
              <div key={a.alertaId} className="list-item" style={{ alignItems: "flex-start" }}>
                <PrioridadBadge prioridad={a.prioridad} />
                <div className="grow" style={{ whiteSpace: "normal" }}>
                  <div className="row" style={{ gap: 8 }}>
                    <Link href={`/envios/${a.shipmentId}`} className="mono link">
                      {a.shipmentId}
                    </Link>
                    <span className="badge badge-neutral">{a.regla.replace(/_/g, " ")}</span>
                  </div>
                  <div className="muted small" style={{ marginTop: 3 }}>
                    {a.causa}
                  </div>
                  <div className="tiny muted-2" style={{ marginTop: 2 }}>
                    vence {fechaHora(a.venceEn)} · {a.zonaId ?? "sin zona"}
                  </div>
                </div>
              </div>
            ))}
            {data.alertas.length === 0 ? (
              <div className="empty">Sin alertas abiertas. El SLA esta bajo control.</div>
            ) : null}
          </div>
        </section>
      </div>
    </>
  );
}
