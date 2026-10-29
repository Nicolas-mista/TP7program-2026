"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="stack" style={{ paddingTop: 40 }}>
      <div className="banner banner-danger">
        No se pudo cargar la vista. Verifica que MongoDB y los servicios esten arriba.
      </div>
      <div className="card">
        <h2 className="page-title" style={{ fontSize: 20 }}>
          Error de la aplicacion
        </h2>
        <p className="muted small" style={{ marginTop: 8 }}>
          {error.message}
        </p>
        <div className="row" style={{ marginTop: 16 }}>
          <button className="btn btn-primary" onClick={() => reset()}>
            Reintentar
          </button>
          <Link className="btn" href="/">
            Volver a la torre
          </Link>
        </div>
      </div>
    </div>
  );
}
