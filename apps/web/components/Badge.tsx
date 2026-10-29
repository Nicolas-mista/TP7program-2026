import type { Prioridad } from "@/lib/types";

const CLASE_ESTADO: Record<string, string> = {
  CREADO: "badge-creado",
  INGRESADO_HUB: "badge-ingresado-hub",
  CLASIFICADO: "badge-clasificado",
  EN_REPARTO: "badge-en-reparto",
  ENTREGADO: "badge-entregado",
  ENTREGA_FALLIDA: "badge-entrega-fallida",
};

export function EstadoBadge({ estado }: { estado: string }) {
  return (
    <span className={`badge ${CLASE_ESTADO[estado] ?? "badge-neutral"}`}>
      {estado.replace(/_/g, " ")}
    </span>
  );
}

const CLASE_PRIORIDAD: Record<Prioridad, string> = {
  CRITICA: "prio-critica",
  ALTA: "prio-alta",
  MEDIA: "prio-media",
};

export function PrioridadBadge({ prioridad }: { prioridad: Prioridad }) {
  return <span className={`badge ${CLASE_PRIORIDAD[prioridad] ?? "badge-neutral"}`}>{prioridad}</span>;
}

export function DecisionBadge({ decision }: { decision: string }) {
  const clase =
    decision === "REINTENTO" ? "badge-warn" : decision === "DEVOLUCION" ? "badge-danger" : "badge-neutral";
  return <span className={`badge ${clase}`}>{decision}</span>;
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "ok" | "warn" | "danger";
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
