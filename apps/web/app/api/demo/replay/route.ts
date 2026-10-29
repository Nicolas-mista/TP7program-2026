import { ANALYTICS_URL } from "@/lib/config";
import { postJson } from "@/lib/servicios";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(): Promise<Response> {
  const r = await postJson<{ activo: boolean; procesados: number }>(`${ANALYTICS_URL}/replay`, {});
  return Response.json(
    r.data ?? { ok: false, error: r.error ?? "analitica sin respuesta" },
    { status: r.status || 502 },
  );
}
