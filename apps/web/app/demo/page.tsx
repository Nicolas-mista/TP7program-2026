import { DemoPanel } from "@/components/DemoPanel";
import { ANALYTICS_URL, PROJECTOR_URL, SIMULATOR_URL } from "@/lib/config";
import { getJson } from "@/lib/servicios";
import type { DemoStatus, SimStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function DemoPage() {
  const [sim, proyector, analitica] = await Promise.all([
    getJson<SimStatus>(`${SIMULATOR_URL}/status`),
    getJson<DemoStatus["proyector"]>(`${PROJECTOR_URL}/stats`),
    getJson<DemoStatus["analitica"]>(`${ANALYTICS_URL}/stats`),
  ]);

  const initial: DemoStatus = {
    sim: sim.data,
    lag: [],
    proyector: proyector.data,
    analitica: analitica.data,
    ts: new Date().toISOString(),
  };

  return <DemoPanel initial={initial} />;
}
