import { LiveTower } from "@/components/LiveTower";
import { DbDown } from "@/components/DbDown";
import { getDb } from "@/lib/mongo";
import { getTowerSnapshot } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  try {
    const db = await getDb();
    const snapshot = await getTowerSnapshot(db);
    return <LiveTower initial={snapshot} />;
  } catch (error) {
    return <DbDown error={error} />;
  }
}
