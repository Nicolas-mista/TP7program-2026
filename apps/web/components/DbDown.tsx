import Link from "next/link";

export function DbDown({ error }: { error: unknown }) {
  const mensaje = error instanceof Error ? error.message : String(error);
  return (
    <div className="stack" style={{ paddingTop: 24 }}>
      <div className="banner banner-danger">
        No hay conexion con MongoDB. Levanta la infraestructura con <code>npm run up</code> o{" "}
        <code>npm run infra</code>.
      </div>
      <div className="card">
        <div className="card-title">Detalle</div>
        <p className="mono muted small" style={{ marginTop: 8 }}>
          {mensaje}
        </p>
        <div className="row" style={{ marginTop: 14 }}>
          <Link className="btn" href="/">
            Reintentar
          </Link>
        </div>
      </div>
    </div>
  );
}
