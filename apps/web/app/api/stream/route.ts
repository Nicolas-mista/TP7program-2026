import { getDb } from "@/lib/mongo";
import { getShipmentSnapshot, getTowerSnapshot, getTrackingSnapshot } from "@/lib/queries";
import { suscribir } from "@/lib/live";
import type { Scope } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const scope = (url.searchParams.get("scope") ?? "tower") as Scope;
  const id = url.searchParams.get("id") ?? "";

  if (scope !== "tower" && !id) {
    return new Response("falta el parametro id", { status: 400 });
  }

  const encoder = new TextEncoder();
  let desuscribir: (() => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      let vivo = true;

      const enviar = (data: unknown): void => {
        if (!vivo) return;
        try {
          controller.enqueue(encoder.encode(`event: snapshot\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          vivo = false;
        }
      };

      const ping = setInterval(() => {
        if (!vivo) return;
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          vivo = false;
        }
      }, 15_000);

      void (async () => {
        try {
          const db = await getDb();
          if (scope === "tower") enviar(await getTowerSnapshot(db));
          else if (scope === "tracking") enviar(await getTrackingSnapshot(db, id));
          else enviar(await getShipmentSnapshot(db, id));

          desuscribir = await suscribir({
            id: crypto.randomUUID(),
            scope,
            shipmentId: scope === "tower" ? undefined : id,
            enviar,
          });
        } catch (error) {
          console.error("[sse]", (error as Error).message);
        }
      })();

      const abortar = (): void => {
        vivo = false;
        clearInterval(ping);
        desuscribir?.();
        try {
          controller.close();
        } catch {
          // ya cerrado
        }
      };

      request.signal.addEventListener("abort", abortar);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
