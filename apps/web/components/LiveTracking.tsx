"use client";

import { EstadoBadge } from "./Badge";
import { useLive } from "./useLive";
import { fechaHora } from "@/lib/fechas";
import type { TrackingSnapshot } from "@/lib/types";

const PASOS = ["CREADO", "INGRESADO_HUB", "CLASIFICADO", "EN_REPARTO", "ENTREGADO"];

function mensaje(estado: string): string {
  switch (estado) {
    case "CREADO":
      return "Recibimos tu envio y estamos coordinando el retiro.";
    case "INGRESADO_HUB":
      return "Tu envio ya esta en el centro de distribucion.";
    case "CLASIFICADO":
      return "Estamos preparando tu envio para la entrega.";
    case "EN_REPARTO":
      return "Tu envio esta en camino.";
    case "ENTREGADO":
      return "Tu envio fue entregado.";
    case "ENTREGA_FALLIDA":
      return "No pudimos entregar tu envio. Vamos a coordinar un nuevo intento.";
    default:
      return "Estamos actualizando el estado de tu envio.";
  }
}

export function LiveTracking({ initial }: { initial: TrackingSnapshot }) {
  const { data, live } = useLive<TrackingSnapshot>("tracking", initial.shipmentId, initial);
  const idx = PASOS.indexOf(data.estado);
  const fallido = data.estado === "ENTREGA_FALLIDA";

  return (
    <div className="stack" style={{ maxWidth: 760, margin: "0 auto" }}>
      <div className="page-head">
        <div>
          <p className="page-sub">Seguimiento publico</p>
          <h1 className="page-title mono">{data.shipmentId}</h1>
        </div>
        <span className={`live ${live ? "on" : ""}`}>
          <span className="live-dot" />
          {live ? "en vivo" : "reconectando"}
        </span>
      </div>

      <section className="card">
        <div className="hero">
          <EstadoBadge estado={data.estado} />
          <div className="hero-estado">{data.estado.replace(/_/g, " ")}</div>
          <p className="muted">{mensaje(data.estado)}</p>
          {data.promesa ? (
            <p className="small muted-2">
              Entrega estimada: <strong style={{ color: "var(--text)" }}>{fechaHora(data.promesa.venceEn)}</strong>{" "}
              · franja {data.promesa.franja}
            </p>
          ) : null}
        </div>

        <div className="steps" style={{ marginTop: 8 }}>
          {PASOS.map((paso, i) => {
            const clase = i < idx ? "done" : i === idx ? (fallido && i === 4 ? "fail" : "current") : "";
            const etiqueta = i === 4 && fallido ? "FALLIDA" : paso.replace(/_/g, " ");
            return (
              <div key={paso} className={`step ${clase}`}>
                <span className="step-num">{i + 1}</span>
                {etiqueta}
              </div>
            );
          })}
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <span className="card-title">Recorrido del envio</span>
          <span className="card-hint">actualizado {fechaHora(data.actualizadoEn)}</span>
        </div>
        <div className="timeline">
          {[...data.historial]
            .sort((a, b) => a.ocurridoEn.localeCompare(b.ocurridoEn))
            .map((h, i, arr) => (
              <div key={`${h.tipo}-${h.ocurridoEn}-${i}`} className="tl-item">
                <span className={`tl-dot ${i === arr.length - 1 ? "activo" : ""}`} />
                <div className="tl-time">{fechaHora(h.ocurridoEn)}</div>
                <div className="tl-body">
                  <EstadoBadge estado={h.tipo} />
                </div>
              </div>
            ))}
          {data.historial.length === 0 ? <div className="empty">Sin eventos todavia.</div> : null}
        </div>
      </section>

      <p className="tiny muted-2" style={{ textAlign: "center" }}>
        RutaSur · vista publica generada a partir del proyector de envios
      </p>
    </div>
  );
}
