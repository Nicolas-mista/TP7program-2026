import { ANALYTICS_URL, PROJECTOR_URL, SIMULATOR_URL } from "@/lib/config";
import { lagGrupos } from "@/lib/kafka-admin";
import { getJson } from "@/lib/servicios";
import type { DemoStatus, SimStatus } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const [sim, proyector, analitica, lag] = await Promise.all([
    getJson<SimStatus>(`${SIMULATOR_URL}/status`),
    getJson<DemoStatus["proyector"]>(`${PROJECTOR_URL}/stats`),
    getJson<DemoStatus["analitica"]>(`${ANALYTICS_URL}/stats`),
    lagGrupos().catch(() => []),
  ]);

  const body: DemoStatus = {
    sim: sim.data,
    lag,
    proyector: proyector.data,
    analitica: analitica.data,
    ts: new Date().toISOString(),
  };
  return Response.json(body);
}
