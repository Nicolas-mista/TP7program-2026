import { notFound } from "next/navigation";
import { DbDown } from "@/components/DbDown";
import { LiveTracking } from "@/components/LiveTracking";
import { getDb } from "@/lib/mongo";
import { getTrackingSnapshot } from "@/lib/queries";
import type { TrackingSnapshot } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function TrackingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let snapshot: TrackingSnapshot | null;
  try {
    const db = await getDb();
    snapshot = await getTrackingSnapshot(db, id);
  } catch (error) {
    return <DbDown error={error} />;
  }
  if (!snapshot) notFound();
  return <LiveTracking initial={snapshot} />;
}
