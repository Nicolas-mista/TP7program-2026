import { lagGrupos } from "@/lib/kafka-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  try {
    return Response.json({ grupos: await lagGrupos() });
  } catch (error) {
    return Response.json(
      { grupos: [], error: (error as Error).message },
      { status: 503 },
    );
  }
}
