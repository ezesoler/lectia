import type { HttpDeps } from "./types";

/** Esperas entre reintentos (FR-027): 1 s, 2 s, 4 s → hasta 4 intentos en total. */
export const BACKOFF_MS = [1000, 2000, 4000] as const;
export const REQUEST_TIMEOUT_MS = 5000;
const MAX_RETRY_AFTER_MS = 10_000;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function retryAfterMs(res: Response): number | null {
  const header = res.headers.get("retry-after");
  if (!header) return null;
  const seconds = Number(header);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  const ms = seconds * 1000;
  return ms <= MAX_RETRY_AFTER_MS ? ms : null;
}

/**
 * GET JSON con timeout y reintentos con backoff exponencial ante error de red, timeout, 429 o 5xx.
 * Devuelve `null` si se agotan los reintentos o la respuesta no es recuperable (otro 4xx):
 * el enriquecimiento nunca interrumpe la importación.
 */
export async function getJson<T>(url: string, deps: HttpDeps = {}): Promise<T | null> {
  const doFetch = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? defaultSleep;
  const schedule = deps.schedule ?? (<R>(task: () => Promise<R>) => task());

  for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt += 1) {
    let wait: number = BACKOFF_MS[attempt] ?? 0;
    try {
      const res = await schedule(() =>
        doFetch(url, {
          headers: { Accept: "application/json", ...deps.headers },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        })
      );
      if (res.ok) return (await res.json()) as T;
      if (res.status !== 429 && res.status < 500) return null; // 4xx: reintentar no ayuda
      wait = retryAfterMs(res) ?? wait;
    } catch {
      // red caída o timeout: se reintenta
    }
    if (attempt < BACKOFF_MS.length) await sleep(wait);
  }
  return null;
}
