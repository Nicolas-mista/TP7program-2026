import { SIMULATOR_URL } from "@/lib/config";
import { postJson } from "@/lib/servicios";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const body = await request.json().catch(() => ({}));
  const payload: { pausado?: boolean; rate?: number } = {};
  if (typeof body?.pausado === "boolean") payload.pausado = body.pausado;
  if (typeof body?.rate === "number" && body.rate > 0) payload.rate = body.rate;

  if (Object.keys(payload).length === 0) {
    return Response.json({ ok: false, error: "nada para cambiar" }, { status: 400 });
  }

  const r = await postJson(`${SIMULATOR_URL}/control`, payload);
  return Response.json(r.data ?? { ok: false, error: r.error ?? "simulador sin respuesta" }, {
    status: r.status || 502,
  });
}
