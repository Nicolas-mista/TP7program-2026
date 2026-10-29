import Link from "next/link";
import { AutoRefresh } from "@/components/AutoRefresh";
import { DbDown } from "@/components/DbDown";
import { ReplayButton } from "@/components/ReplayButton";
import { StatCard } from "@/components/StatCard";
import { ANALYTICS_URL } from "@/lib/config";
import { haceDias, hoyISO, minutos, numero, porcentaje } from "@/lib/fechas";
import { getDb } from "@/lib/mongo";
import { getAnalitica, type FiltrosAnalitica } from "@/lib/queries";
import { getJson } from "@/lib/servicios";
import type { AnaliticaData } from "@/lib/types";

export const dynamic = "force-dynamic";

type Params = Record<string, string | string[] | undefined>;

function uno(valor: string | string[] | undefined): string | undefined {
  if (Array.isArray(valor)) return valor[0];
  const limpio = valor?.trim();
  return limpio ? limpio : undefined;
}

function Barra({ valor, tone }: { valor: number; tone?: "ok" | "warn" | "danger" }) {
  const clase = tone ?? (valor >= 80 ? "ok" : valor >= 60 ? "warn" : "danger");
  return (
    <div className="bar-track" style={{ width: 120 }}>
      <div className={`bar-fill ${clase}`} style={{ width: `${Math.max(0, Math.min(100, valor))}%` }} />
    </div>
  );
}

export default async function AnaliticaPage({ searchParams }: { searchParams: Promise<Params> }) {
  const raw = await searchParams;
  const filtros: FiltrosAnalitica = {
    zona: uno(raw.zona),
    hub: uno(raw.hub),
    desde: uno(raw.desde),
    hasta: uno(raw.hasta),
  };

  let data: AnaliticaData;
  try {
    const db = await getDb();
    data = await getAnalitica(db, filtros);
  } catch (error) {
    return <DbDown error={error} />;
  }

  const stats = await getJson<{ replay?: { activo?: boolean; procesados?: number } }>(
    `${ANALYTICS_URL}/stats`,
  );
  const replayActivo = Boolean(stats.data?.replay?.activo);

  const totalFallos = data.motivos.reduce((acc, m) => acc + m.total, 0);

  return (
    <>
      <AutoRefresh segundos={10} />

      <div className="page-head">
        <div>
          <h1 className="page-title">Analitica operativa</h1>
          <p className="page-sub">
            Agregados incrementales del CU4 · tasa de primer intento y cumplimiento de SLA
          </p>
        </div>
        <div className="row" style={{ alignItems: "flex-start" }}>
          <span className="pill">actualiza cada 10 s</span>
          <ReplayButton activo={replayActivo} />
        </div>
      </div>

      <section className="card" style={{ marginBottom: 14 }}>
        <form method="get" className="toolbar">
          <div className="field">
            <label htmlFor="zona">Zona</label>
            <select id="zona" name="zona" defaultValue={filtros.zona ?? ""}>
              <option value="">Todas</option>
              {data.filtros.zonas.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="hub">Hub</label>
            <select id="hub" name="hub" defaultValue={filtros.hub ?? ""}>
              <option value="">Todos</option>
              {data.filtros.hubs.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="desde">Desde</label>
            <input id="desde" type="date" name="desde" defaultValue={filtros.desde ?? ""} />
          </div>
          <div className="field">
            <label htmlFor="hasta">Hasta</label>
            <input id="hasta" type="date" name="hasta" defaultValue={filtros.hasta ?? ""} />
          </div>
          <button type="submit" className="btn btn-primary">
            Aplicar
          </button>
          <Link className="btn btn-ghost" href="/analitica">
            Limpiar
          </Link>
          <div className="row right" style={{ gap: 6 }}>
            <Link className="btn btn-sm" href={`/analitica?desde=${hoyISO()}&hasta=${hoyISO()}`}>
              Hoy
            </Link>
            <Link className="btn btn-sm" href={`/analitica?desde=${haceDias(6)}&hasta=${hoyISO()}`}>
              7 dias
            </Link>
          </div>
        </form>
      </section>

      <div className="grid grid-5" style={{ marginBottom: 14 }}>
        <StatCard label="Intentos cerrados" value={numero(data.global.intentos)} hint="entregas + fallos" />
        <StatCard label="Entregas" value={numero(data.global.entregas)} hint="con al menos un exito" tone="ok" />
        <StatCard label="Fallos" value={numero(data.global.fallos)} hint="intentos fallidos" tone="danger" />
        <StatCard
          label="Tasa 1er intento"
          value={`${data.global.tasaPrimerIntento}%`}
          hint="entregas sin fallo previo"
          tone="accent"
        />
        <StatCard
          label="Cumplimiento SLA"
          value={`${data.global.cumplimientoSla}%`}
          hint="entregas dentro de la promesa"
          tone={data.global.cumplimientoSla >= 80 ? "ok" : "warn"}
        />
      </div>

      <div className="grid grid-main" style={{ marginBottom: 14 }}>
        <section className="card">
          <div className="card-head">
            <span className="card-title">Tasa de primer intento por zona y franja</span>
            <span className="card-hint">CU4 · indicador 1</span>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Zona</th>
                  <th>Franja</th>
                  <th className="num">Intentos</th>
                  <th className="num">Fallos</th>
                  <th className="num">Entregas</th>
                  <th>Tasa 1er intento</th>
                </tr>
              </thead>
              <tbody>
                {data.porZonaFranja.map((r) => (
                  <tr key={`${r.zonaId}-${r.franja}`}>
                    <td className="mono">{r.zonaId}</td>
                    <td>
                      <span className="badge badge-neutral">{r.franja}</span>
                    </td>
                    <td className="num">{numero(r.intentos)}</td>
                    <td className="num">{numero(r.fallos)}</td>
                    <td className="num">{numero(r.entregas)}</td>
                    <td>
                      <div className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
                        <Barra valor={r.tasaPrimerIntento} />
                        <span className="mono">{r.tasaPrimerIntento}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
                {data.porZonaFranja.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="empty">
                      Sin metricas para los filtros seleccionados.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <span className="card-title">Motivos de fallo por zona</span>
            <span className="card-hint">{numero(totalFallos)} fallos</span>
          </div>
          <div className="stack">
            {data.motivos.map((m) => {
              const total = Math.max(1, m.total);
              return (
                <div key={m.zonaId}>
                  <div className="between" style={{ marginBottom: 4 }}>
                    <span className="mono small">{m.zonaId}</span>
                    <span className="tiny muted-2">{numero(m.total)} fallos</span>
                  </div>
                  <div className="motivo-bar" title={`AUSENTE ${m.AUSENTE} · DIRECCION ${m.DIRECCION_INCORRECTA} · RECHAZO ${m.RECHAZADO} · ZONA ${m.ZONA_INACCESIBLE}`}>
                    <span className="motivo-ausente" style={{ width: `${(m.AUSENTE / total) * 100}%` }} />
                    <span className="motivo-direccion" style={{ width: `${(m.DIRECCION_INCORRECTA / total) * 100}%` }} />
                    <span className="motivo-rechazo" style={{ width: `${(m.RECHAZADO / total) * 100}%` }} />
                    <span className="motivo-zona" style={{ width: `${(m.ZONA_INACCESIBLE / total) * 100}%` }} />
                  </div>
                  <div className="legend" style={{ marginTop: 4 }}>
                    <span className="legend-item">
                      <span className="swatch motivo-ausente" /> {m.AUSENTE}
                    </span>
                    <span className="legend-item">
                      <span className="swatch motivo-direccion" /> {m.DIRECCION_INCORRECTA}
                    </span>
                    <span className="legend-item">
                      <span className="swatch motivo-rechazo" /> {m.RECHAZADO}
                    </span>
                    <span className="legend-item">
                      <span className="swatch motivo-zona" /> {m.ZONA_INACCESIBLE}
                    </span>
                  </div>
                </div>
              );
            })}
            {data.motivos.length === 0 ? <div className="empty">Sin fallos registrados.</div> : null}
          </div>
        </section>
      </div>

      <div className="grid grid-2">
        <section className="card">
          <div className="card-head">
            <span className="card-title">Cumplimiento de SLA por hub</span>
            <span className="card-hint">entregas dentro de la promesa</span>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Hub</th>
                  <th className="num">Entregas</th>
                  <th className="num">En fecha</th>
                  <th>Cumplimiento</th>
                </tr>
              </thead>
              <tbody>
                {data.slaPorHub.map((h) => (
                  <tr key={h.hubId}>
                    <td className="mono">{h.hubId}</td>
                    <td className="num">{numero(h.entregas)}</td>
                    <td className="num">{numero(h.enFecha)}</td>
                    <td>
                      <div className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
                        <Barra valor={h.cumplimiento} />
                        <span className="mono">{h.cumplimiento}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
                {data.slaPorHub.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="empty">
                      Sin entregas para evaluar.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <span className="card-title">Tiempo hub a reparto</span>
            <span className="card-hint">CU4 · replay del historico</span>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Hub</th>
                  <th className="num">Minutos promedio</th>
                  <th className="num">Muestras</th>
                </tr>
              </thead>
              <tbody>
                {data.tiemposHub.map((t) => (
                  <tr key={t.hubId}>
                    <td className="mono">{t.hubId}</td>
                    <td className="num">{minutos(t.minutosPromedio)}</td>
                    <td className="num">{numero(t.muestras)}</td>
                  </tr>
                ))}
                {data.tiemposHub.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="empty">
                      Todavia no hay muestras. Usa &quot;Reprocesar historico&quot;.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <p className="tiny muted-2" style={{ marginTop: 10 }}>
            El replay usa un grupo de consumidores nuevo y lee <code>envios.estados</code> desde el
            inicio, sin afectar al resto de los servicios.
          </p>
        </section>
      </div>

      <p className="tiny muted-2" style={{ marginTop: 16 }}>
        Las tasas se calculan sobre resultados cerrados: {porcentaje(data.global.entregasPrimerIntento, data.global.entregasPrimerIntento + data.global.primerosIntentosFallidos)}% de
        primer intento en el periodo filtrado.
      </p>
    </>
  );
}
