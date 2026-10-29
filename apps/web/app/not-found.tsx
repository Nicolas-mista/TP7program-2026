import Link from "next/link";

export default function NotFound() {
  return (
    <div className="stack" style={{ paddingTop: 40 }}>
      <div className="card">
        <h2 className="page-title" style={{ fontSize: 20 }}>
          No encontramos ese recurso
        </h2>
        <p className="page-sub">
          El envio puede no haberse proyectado todavia. La torre se actualiza en vivo.
        </p>
        <div className="row" style={{ marginTop: 16 }}>
          <Link className="btn btn-primary" href="/">
            Ir a la torre de control
          </Link>
        </div>
      </div>
    </div>
  );
}
