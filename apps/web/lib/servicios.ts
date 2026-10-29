export interface ResultadoJson<T> {
  ok: boolean;
  status: number;
  data: T | null;
  error?: string;
}

async function pedir<T>(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<ResultadoJson<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, cache: "no-store", signal: controller.signal });
    const texto = await res.text();
    let data: T | null = null;
    try {
      data = texto ? (JSON.parse(texto) as T) : null;
    } catch {
      data = null;
    }
    return {
      ok: res.ok,
      status: res.status,
      data,
      error: res.ok ? undefined : texto.slice(0, 400) || res.statusText,
    };
  } catch (error) {
    return { ok: false, status: 0, data: null, error: (error as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

export function getJson<T>(url: string, timeoutMs = 4_000): Promise<ResultadoJson<T>> {
  return pedir<T>(url, { method: "GET" }, timeoutMs);
}

export function postJson<T>(url: string, body: unknown, timeoutMs = 30_000): Promise<ResultadoJson<T>> {
  return pedir<T>(
    url,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
    },
    timeoutMs,
  );
}
