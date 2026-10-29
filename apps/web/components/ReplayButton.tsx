"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ReplayButton({ activo }: { activo: boolean }) {
  const router = useRouter();
  const [cargando, setCargando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);

  const iniciar = async (): Promise<void> => {
    setCargando(true);
    setMensaje(null);
    try {
      const res = await fetch("/api/demo/replay", { method: "POST" });
      const json = await res.json();
      setMensaje(
        res.ok
          ? "Replay iniciado: el cuarto indicador se esta reconstruyendo desde el inicio del topic."
          : `Error: ${json?.error ?? res.statusText}`,
      );
      router.refresh();
    } catch (error) {
      setMensaje(`Error: ${(error as Error).message}`);
    } finally {
      setCargando(false);
    }
  };

  return (
    <div className="stack-sm" style={{ alignItems: "flex-end" }}>
      <button className="btn" onClick={() => void iniciar()} disabled={cargando || activo}>
        {cargando ? "Iniciando..." : activo ? "Replay en curso" : "Reprocesar historico"}
      </button>
      {mensaje ? <span className="tiny muted-2" style={{ maxWidth: 320, textAlign: "right" }}>{mensaje}</span> : null}
    </div>
  );
}
