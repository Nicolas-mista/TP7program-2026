import { SIMULATOR_URL } from "@/lib/config";
import { postJson } from "@/lib/servicios";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const body = await request.json().catch(() => ({}));
  const tipo = String(body?.tipo ?? "").trim();
  if (!tipo) return Response.json({ ok: false, error: "falta el tipo de inyeccion" }, { status: 400 });

  const r = await postJson<{ ok: boolean; detalle?: string }>(`${SIMULATOR_URL}/inject`, { tipo });
  return Response.json(r.data ?? { ok: false, error: r.error ?? "simulador sin respuesta" }, {
    status: r.status || 502,
  });
}
