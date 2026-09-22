// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { BACKOFF_MS, getBinary } from "@/lib/covers/download";

function okResponse(body: Uint8Array, contentType = "image/jpeg", extraHeaders: Record<string, string> = {}) {
  return new Response(body as BodyInit, { status: 200, headers: { "Content-Type": contentType, ...extraHeaders } });
}

function makeDeps(routes: (() => Response | Promise<Response>)[]) {
  const sleeps: number[] = [];
  let call = 0;
  const fetchImpl = vi.fn(async () => {
    const route = routes[Math.min(call, routes.length - 1)]!;
    call += 1;
    return route();
  }) as unknown as typeof fetch;
  return { deps: { fetchImpl, sleep: async (ms: number) => void sleeps.push(ms) }, sleeps, fetchImpl };
}

describe("getBinary", () => {
  it("éxito directo: devuelve los bytes y el content-type", async () => {
    const body = new Uint8Array([1, 2, 3, 4]);
    const { deps } = makeDeps([() => okResponse(body)]);
    const r = await getBinary("https://example.com/a.jpg", deps);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect([...r.bytes]).toEqual([1, 2, 3, 4]);
      expect(r.contentType).toBe("image/jpeg");
    }
  });

  it("503 dos veces y luego funciona: reintenta con 1s y 2s", async () => {
    const { deps, sleeps, fetchImpl } = makeDeps([
      () => new Response(null, { status: 503 }),
      () => new Response(null, { status: 503 }),
      () => okResponse(new Uint8Array([9])),
    ]);
    const r = await getBinary("https://example.com/a.jpg", deps);
    expect(r.kind).toBe("ok");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([1000, 2000]);
  });

  it("404 no reintenta: es 'absent'", async () => {
    const { deps, fetchImpl } = makeDeps([() => new Response(null, { status: 404 })]);
    const r = await getBinary("https://example.com/a.jpg", deps);
    expect(r).toEqual({ kind: "absent" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("410 y 403 también son 'absent' sin reintentar", async () => {
    for (const status of [410, 403]) {
      const { deps, fetchImpl } = makeDeps([() => new Response(null, { status })]);
      expect(await getBinary("https://example.com/a.jpg", deps)).toEqual({ kind: "absent" });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  });

  it("agotados los 3 reintentos (1s/2s/4s) devuelve 'failed'", async () => {
    const { deps, sleeps, fetchImpl } = makeDeps([() => new Response(null, { status: 500 })]);
    const r = await getBinary("https://example.com/a.jpg", deps);
    expect(r).toEqual({ kind: "failed" });
    expect(fetchImpl).toHaveBeenCalledTimes(4); // 1 intento + 3 reintentos
    expect(sleeps).toEqual([...BACKOFF_MS]);
  });

  it("un error de red también cuenta como fallo transitorio y se reintenta", async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      if (call === 1) throw new Error("ECONNRESET");
      return okResponse(new Uint8Array([1]));
    }) as unknown as typeof fetch;
    const r = await getBinary("https://example.com/a.jpg", { fetchImpl, sleep: async () => undefined });
    expect(r.kind).toBe("ok");
  });

  it("respeta Retry-After (≤ 10 s)", async () => {
    let call = 0;
    const sleeps: number[] = [];
    const fetchImpl = vi.fn(async () => {
      call += 1;
      if (call === 1) return new Response(null, { status: 429, headers: { "Retry-After": "3" } });
      return okResponse(new Uint8Array([1]));
    }) as unknown as typeof fetch;
    await getBinary("https://example.com/a.jpg", { fetchImpl, sleep: async (ms) => void sleeps.push(ms) });
    expect(sleeps).toEqual([3000]);
  });

  it("Retry-After por encima de 10 s se ignora y usa el backoff normal", async () => {
    let call = 0;
    const sleeps: number[] = [];
    const fetchImpl = vi.fn(async () => {
      call += 1;
      if (call === 1) return new Response(null, { status: 429, headers: { "Retry-After": "3600" } });
      return okResponse(new Uint8Array([1]));
    }) as unknown as typeof fetch;
    await getBinary("https://example.com/a.jpg", { fetchImpl, sleep: async (ms) => void sleeps.push(ms) });
    expect(sleeps).toEqual([1000]);
  });

  it("corta la descarga al superar el límite sin leer todo el cuerpo (imagen 'huge')", async () => {
    const limit = 10 * 1024 * 1024 + 1024;
    const total = limit + 5 * 1024 * 1024; // el cuerpo declarado es bastante más grande
    let pulled = 0;
    const chunkSize = 64 * 1024;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulled >= total) {
          controller.close();
          return;
        }
        const size = Math.min(chunkSize, total - pulled);
        controller.enqueue(new Uint8Array(size));
        pulled += size;
      },
    });
    const fetchImpl = vi.fn(
      async () => new Response(stream, { status: 200, headers: { "Content-Type": "image/jpeg" } })
    ) as unknown as typeof fetch;

    const r = await getBinary("https://example.com/huge.jpg", { fetchImpl });
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.bytes.length).toBeGreaterThan(limit);
      expect(r.bytes.length).toBeLessThan(total); // se cortó antes de leer todo
    }
  });
});
