import { MAX_COVER_BYTES } from "./image-info";
import type { FetchOutcome } from "./types";

/** Esperas entre reintentos (mismo criterio que lib/enrichment/http.ts, FR-010/FR-027). */
export const BACKOFF_MS = [1000, 2000, 4000] as const;
export const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RETRY_AFTER_MS = 10_000;
/** Margen sobre el máximo aceptado (image-info.ts): confirma el corte sin leer todo el cuerpo. */
const READ_LIMIT = MAX_COVER_BYTES + 1024;

export interface DownloadDeps {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function retryAfterMs(res: Response): number | null {
  const header = res.headers.get("retry-after");
  if (!header) return null;
  const seconds = Number(header);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  const ms = seconds * 1000;
  return ms <= MAX_RETRY_AFTER_MS ? ms : null;
}

/** Lee hasta `limit` bytes y corta ahí: una portada nunca necesita más para saber que es inválida. */
async function readUpTo(res: Response, limit: number): Promise<Uint8Array> {
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array(await res.arrayBuffer());

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.length;
      if (total > limit) {
        await reader.cancel().catch(() => undefined);
        break;
      }
    }
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * Descarga una portada con reintentos y backoff exponencial (research.md R5). `absent` para
 * respuestas que dicen "esta fuente no tiene esta variante" (no vale la pena reintentar); `failed`
 * cuando se agotan los reintentos ante algo transitorio. La validación de contenido (tamaño,
 * formato, reemplazos) es responsabilidad de `inspectImage`, no de este módulo.
 */
export async function getBinary(url: string, deps: DownloadDeps = {}): Promise<FetchOutcome> {
  const doFetch = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? defaultSleep;

  for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt += 1) {
    let wait: number = BACKOFF_MS[attempt] ?? 0;
    try {
      const res = await doFetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (res.status === 404 || res.status === 410 || res.status === 403) {
        return { kind: "absent" };
      }
      if (res.ok) {
        const bytes = await readUpTo(res, READ_LIMIT);
        return { kind: "ok", bytes, contentType: res.headers.get("content-type") };
      }
      if (res.status !== 429 && res.status < 500) return { kind: "absent" }; // otro 4xx: no ayuda reintentar
      wait = retryAfterMs(res) ?? wait;
    } catch {
      // red caída o timeout: se reintenta
    }
    if (attempt < BACKOFF_MS.length) await sleep(wait);
  }
  return { kind: "failed" };
}
