"use client";

import { useEffect, useState } from "react";

type Scope = "tower" | "shipment" | "tracking";

/**
 * Se suscribe al endpoint SSE de la vista y devuelve el ultimo snapshot.
 * El primer valor es el renderizado en el servidor, para que la pagina no
 * parpadee mientras llega el primer evento.
 */
export function useLive<T>(scope: Scope, id: string | undefined, initial: T) {
  const [data, setData] = useState<T>(initial);
  const [live, setLive] = useState(false);

  useEffect(() => {
    const url = `/api/stream?scope=${scope}${id ? `&id=${encodeURIComponent(id)}` : ""}`;
    const source = new EventSource(url);

    const onSnapshot = (event: MessageEvent) => {
      try {
        setData(JSON.parse(event.data) as T);
        setLive(true);
      } catch {
        // snapshot corrupto: se ignora y llega el siguiente
      }
    };

    source.addEventListener("snapshot", onSnapshot as EventListener);
    source.onopen = () => setLive(true);
    source.onerror = () => setLive(false);

    return () => {
      source.removeEventListener("snapshot", onSnapshot as EventListener);
      source.close();
    };
  }, [scope, id]);

  return { data, live };
}
