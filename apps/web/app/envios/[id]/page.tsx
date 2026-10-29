import { notFound } from "next/navigation";
import { DbDown } from "@/components/DbDown";
import { LiveShipment } from "@/components/LiveShipment";
import { getDb } from "@/lib/mongo";
import { getShipmentSnapshot } from "@/lib/queries";
import type { ShipmentSnapshot } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function EnvioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let snapshot: ShipmentSnapshot;
  try {
    const db = await getDb();
    snapshot = await getShipmentSnapshot(db, id);
  } catch (error) {
    return <DbDown error={error} />;
  }
  if (!snapshot.envio) notFound();
  return <LiveShipment initial={snapshot} />;
}
