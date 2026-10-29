"use client";

import Link from "next/link";
import { DecisionBadge, EstadoBadge, PrioridadBadge } from "./Badge";
import { useLive } from "./useLive";
import { fechaHora } from "@/lib/fechas";
import type { EnvioView, ShipmentSnapshot } from "@/lib/types";

const PASOS = ["CREADO", "INGRESADO_HUB", "CLASIFICADO", "EN_REPARTO", "ENTREGA"];

function indicePaso(estado: string): number {
  if (estado === "ENTREGADO" || estado === "ENTREGA_FALLIDA") return 4;
  const i = PASOS.indexOf(estado);
  return i < 0 ? 0 : i;
}

function Datos({ envio }: { envio: EnvioView }) {
  return (
    <div className="stack-sm">
      <div className="between">
        <span className="muted-2 small">Zona</span>
        <span className="mono">{envio.zonaId ?? "-"}</span>
      </div>
      <div className="between">
        <span className="muted-2 small">Hub</span>
        <span className="mono">{envio.hubId ?? "-"}</span>
      </div>
      <div className="between">
        <span className="muted-2 small">Repartidor</span>
        <span className="mono">{envio.repartidorId ?? "-"}</span>
      </div>
      <div className="between">
        <span className="muted-2 small">Intento</span>
        <span className="mono">{envio.intento}</span>
      </div>
      <div className="between">
        <span className="muted-2 small">Ultimo evento</span>
        <span className="small">{fechaHora(envio.ultimoEventoEn)}</span>
      </div>
      {envio.proximoIntento ? (
        <div className="between">
          <span className="muted-2 small">Proximo intento</span>
          <span className="small">
            {fechaHora(envio.proximoIntento.fechaProgramada)} · {envio.proximoIntento.franja}
          </span>
        </div>
      ) : null}
      {envio.devolucion ? (
        <div className="between">
          <span className="muted-2 small">Circuito</span>
          <span className="badge badge-danger">DEVOLUCION</span>
        </div>
      ) : null}
      {envio.retenido ? (
        <div className="between">
          <span className="muted-2 small">Circuito</span>
          <span className="badge badge-warn">RETENIDO</span>
        </div>
      ) : null}
    </div>
  );
}

export function LiveShipment({ initial }: { initial: ShipmentSnapshot }) {
  const { data, live } = useLive<ShipmentSnapshot>("shipment", initial.envio?.shipmentId, initial);
  const envio = data.envio;

  if (!envio) {
    return (
      <div className="card" style={{ marginTop: 24 }}>
        <h2 className="page-title" style={{ fontSize: 20 }}>
          Envio no encontrado
        </h2>
        <p className="page-sub">
          Puede que todavia no se haya proyectado. Los eventos tardan unos segundos en llegar.
        </p>
        <div className="row" style={{ marginTop: 14 }}>
          <Link className="btn" href="/">
            Volver a la torre
          </Link>
        </div>
      </div>
    );
  }

  const idx = indicePaso(envio.estado);
  const fallido = envio.estado === "ENTREGA_FALLIDA";
  const historial = [...envio.historial].sort((a, b) => a.secuencia - b.secuencia);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="row" style={{ marginBottom: 6 }}>
            <Link href="/" className="link small">
              Torre
            </Link>
            <span className="muted-2 small">/</span>
            <span className="mono small">{envio.shipmentId}</span>
          </div>
          <h1 className="page-title mono" style={{ fontSize: 24 }}>
            {envio.shipmentId}
          </h1>
          <div className="row" style={{ marginTop: 8 }}>
            <EstadoBadge estado={envio.estado} />
            <span className="pill">{envio.intento} intento(s)</span>
            {envio.ultimoMotivo ? <span className="pill">motivo: {envio.ultimoMotivo}</span> : null}
            <Link href={`/tracking/${envio.shipmentId}`} className="link small">
              Ver tracking publico
            </Link>
          </div>
        </div>
        <span className={`live ${live ? "on" : ""}`}>
          <span className="live-dot" />
          {live ? "en vivo" : "reconectando"}
        </span>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="steps">
          {PASOS.map((paso, i) => {
            const clase =
              i < idx ? "done" : i === idx ? (fallido && i === 4 ? "fail" : "current") : "";
            const etiqueta = i === 4 && fallido ? "FALLIDA" : paso.replace(/_/g, " ");
            return (
              <div key={paso} className={`step ${clase}`}>
                <span className="step-num">{i + 1}</span>
                {etiqueta}
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid grid-main">
        <div className="stack">
          <section className="card">
            <div className="card-head">
              <span className="card-title">Historial de estados</span>
              <span className="card-hint">{historial.length} eventos aplicados</span>
            </div>
            <div className="timeline">
              {historial.map((h, i) => (
                <div key={`${h.eventId}-${i}`} className="tl-item">
                  <span className={`tl-dot ${i === historial.length - 1 ? "activo" : ""}`} />
                  <div className="tl-time">{fechaHora(h.ocurridoEn)}</div>
                  <div className="tl-body">
                    <EstadoBadge estado={h.tipo} />
                    <span className="pill">sec {h.secuencia}</span>
                    <span className="pill">intento {h.intento}</span>
                    {h.motivo ? <span className="badge badge-danger">{h.motivo}</span> : null}
                  </div>
                </div>
              ))}
              {historial.length === 0 ? <div className="empty">Sin eventos de estado.</div> : null}
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <span className="card-title">Reprogramaciones</span>
              <span className="card-hint">decisiones del CU2</span>
            </div>
            <div className="list">
              {envio.reprogramaciones.map((r) => (
                <div key={r.eventId} className="list-item" style={{ alignItems: "flex-start" }}>
                  <DecisionBadge decision={r.decision} />
                  <div className="grow" style={{ whiteSpace: "normal" }}>
                    <div className="small">
                      <strong>{r.motivo}</strong> · intento {r.intento} · {fechaHora(r.ocurridoEn)}
                    </div>
                    <div className="muted small" style={{ marginTop: 2 }}>
                      {r.detalle}
                    </div>
                    {r.fechaProgramada ? (
                      <div className="tiny muted-2" style={{ marginTop: 2 }}>
                        programado para {fechaHora(r.fechaProgramada)} · {r.franja}
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
              {envio.reprogramaciones.length === 0 ? (
                <div className="empty">Sin reprogramaciones registradas.</div>
              ) : null}
            </div>
          </section>
        </div>

        <div className="stack">
          <section className="card">
            <div className="card-head">
              <span className="card-title">Promesa de entrega</span>
            </div>
            {envio.promesa ? (
              <div className="stack-sm">
                <div className="between">
                  <span className="muted-2 small">Vence</span>
                  <span className="small">{fechaHora(envio.promesa.venceEn)}</span>
                </div>
                <div className="between">
                  <span className="muted-2 small">Franja</span>
                  <span className="badge badge-neutral">{envio.promesa.franja}</span>
                </div>
                <div className="between">
                  <span className="muted-2 small">Compromiso</span>
                  <span className="mono small">{envio.promesa.compromiso}</span>
                </div>
              </div>
            ) : (
              <div className="empty">La promesa todavia no llego.</div>
            )}
            <div className="divider" />
            <Datos envio={envio} />
          </section>

          <section className="card">
            <div className="card-head">
              <span className="card-title">Alertas de SLA</span>
              <span className="card-hint">{data.alertas.filter((a) => a.estado === "ABIERTA").length} abiertas</span>
            </div>
            <div className="list">
              {data.alertas.map((a) => (
                <div key={a.alertaId} className="list-item" style={{ alignItems: "flex-start" }}>
                  <PrioridadBadge prioridad={a.prioridad} />
                  <div className="grow" style={{ whiteSpace: "normal" }}>
                    <div className="row" style={{ gap: 6 }}>
                      <span className="badge badge-neutral">{a.regla.replace(/_/g, " ")}</span>
                      <span className={`badge ${a.estado === "ABIERTA" ? "badge-danger" : "badge-ok"}`}>
                        {a.estado}
                      </span>
                    </div>
                    <div className="muted small" style={{ marginTop: 2 }}>
                      {a.causa}
                    </div>
                    <div className="tiny muted-2" style={{ marginTop: 2 }}>
                      abierta {fechaHora(a.abiertaEn)}
                      {a.cerradaEn ? ` · cerrada ${fechaHora(a.cerradaEn)}` : ""}
                    </div>
                  </div>
                </div>
              ))}
              {data.alertas.length === 0 ? <div className="empty">Sin alertas.</div> : null}
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <span className="card-title">Notificaciones</span>
              <span className="card-hint">salida del CU2</span>
            </div>
            <div className="list scroll">
              {data.notificaciones.map((n) => (
                <div key={n.notificacionId} className="list-item" style={{ alignItems: "flex-start" }}>
                  <span className="badge badge-neutral">{n.canal}</span>
                  <div className="grow" style={{ whiteSpace: "normal" }}>
                    <div className="tiny muted-2">{n.destinatario} · {fechaHora(n.enviadaEn)}</div>
                    <div className="small" style={{ marginTop: 2 }}>
                      {n.mensaje}
                    </div>
                  </div>
                </div>
              ))}
              {data.notificaciones.length === 0 ? (
                <div className="empty">Sin notificaciones para este envio.</div>
              ) : null}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
