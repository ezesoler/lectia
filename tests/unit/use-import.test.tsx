import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POLL_BACKOFF_MS, POLL_MS, useImport } from "@/components/import/use-import";
import type { ImportStatus } from "@/lib/import/types";

const upload = vi.fn(async () => ({ error: null as { message: string } | null }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ storage: { from: () => ({ uploadToSignedUrl: upload }) } }),
}));

function status(over: Partial<ImportStatus> = {}): ImportStatus {
  return {
    id: "imp-1",
    source: "kindle",
    state: "parsing",
    fileName: "My Clippings.txt",
    fileSize: 1000,
    entriesTotal: 100,
    entriesDone: 10,
    booksCount: 0,
    highlightsNew: 0,
    highlightsDup: 0,
    discarded: 0,
    discardBreakdown: {},
    errorCode: null,
    errorMessage: null,
    errorDetails: null,
    startedAt: "2026-09-21T12:00:00Z",
    finishedAt: null,
    ...over,
  };
}

const json = (body: unknown, init: { status?: number } = {}) =>
  new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json" },
  });

const file = (name = "My Clippings.txt", size = 100) =>
  new File([new Uint8Array(size)], name, { type: "text/plain" });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  upload.mockClear();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

describe("useImport — sondeo", () => {
  it("retoma el sondeo si el estado inicial es parsing y avanza el progreso", async () => {
    fetchMock
      .mockResolvedValueOnce(json(status({ entriesDone: 50 })))
      .mockResolvedValueOnce(json(status({ entriesDone: 100, state: "done", booksCount: 3 })));

    const { result } = renderHook(() => useImport("kindle", status()));
    expect(result.current.phase).toBe("parsing");

    await advance(POLL_MS);
    expect(result.current.status?.entriesDone).toBe(50);
    expect(result.current.phase).toBe("parsing");

    await advance(POLL_MS);
    expect(result.current.phase).toBe("done");
    expect(result.current.status?.booksCount).toBe(3);
  });

  it("se detiene en done y en error", async () => {
    fetchMock.mockResolvedValueOnce(json(status({ state: "done" })));
    renderHook(() => useImport("kindle", status()));
    await advance(POLL_MS);
    const calls = fetchMock.mock.calls.length;
    await advance(POLL_MS * 5);
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it("no sondea si el estado inicial ya terminó", async () => {
    renderHook(() => useImport("kindle", status({ state: "done" })));
    await advance(POLL_MS * 3);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("tras un error de red retrocede a 3 s", async () => {
    fetchMock
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(json(status({ entriesDone: 60 })));
    const { result } = renderHook(() => useImport("kindle", status()));

    await advance(POLL_MS); // 1.º intento falla
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await advance(POLL_MS); // con el ritmo normal ya habría un 2.º intento
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await advance(POLL_BACKOFF_MS - POLL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.status?.entriesDone).toBe(60);
  });

  it("si el import desapareció (404) vuelve a idle", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    const { result } = renderHook(() => useImport("kindle", status()));
    await advance(POLL_MS);
    expect(result.current.phase).toBe("idle");
  });
});

describe("useImport — start", () => {
  it("valida la extensión y el tamaño sin llamar al servidor", async () => {
    const { result } = renderHook(() => useImport("kindle", null));
    await act(async () => result.current.start(file("resaltados.pdf")));
    expect(result.current.message).toContain("Buscá My Clippings.txt");
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => result.current.start(file("My Clippings.txt", 0)));
    expect(result.current.message).toBe("El archivo está vacío.");
  });

  it("flujo feliz: crea, sube, parsea y pasa a parsing", async () => {
    fetchMock
      .mockResolvedValueOnce(
        json(
          { importId: "imp-9", upload: { bucket: "imports", path: "u/imp-9", token: "t" } },
          { status: 201 }
        )
      )
      .mockResolvedValueOnce(json({ state: "parsing" }, { status: 202 }))
      .mockResolvedValueOnce(json(status({ id: "imp-9" })));

    const { result } = renderHook(() => useImport("kindle", null));
    await act(async () => result.current.start(file()));

    expect(upload).toHaveBeenCalledWith("u/imp-9", "t", expect.any(File));
    expect(result.current.phase).toBe("parsing");
    expect(result.current.status?.id).toBe("imp-9");
    expect(result.current.canRetry).toBe(true);
  });

  it("409: muestra el mensaje de importación en curso y no interrumpe la activa (FR-025)", async () => {
    fetchMock
      .mockResolvedValueOnce(
        json(
          { error: { code: "import_in_progress", message: "x", details: { importId: "imp-activo" } } },
          { status: 409 }
        )
      )
      .mockResolvedValueOnce(json(status({ id: "imp-activo", entriesDone: 30 })));

    const { result } = renderHook(() => useImport("kindle", null));
    await act(async () => result.current.start(file()));

    expect(result.current.message).toBe(
      "Ya hay una importación en curso para Kindle. Esperá a que termine."
    );
    expect(result.current.status?.id).toBe("imp-activo");
    expect(result.current.phase).toBe("parsing");
    const methods = fetchMock.mock.calls.map(([, init]) => (init as RequestInit | undefined)?.method);
    expect(methods).not.toContain("DELETE");
    expect(upload).not.toHaveBeenCalled();
  });

  it("si falla la subida libera el cupo con DELETE y avisa", async () => {
    upload.mockResolvedValueOnce({ error: { message: "boom" } });
    fetchMock
      .mockResolvedValueOnce(
        json(
          { importId: "imp-9", upload: { bucket: "imports", path: "u/imp-9", token: "t" } },
          { status: 201 }
        )
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const { result } = renderHook(() => useImport("kindle", null));
    await act(async () => result.current.start(file()));

    expect(fetchMock).toHaveBeenLastCalledWith("/api/imports/imp-9", { method: "DELETE" });
    expect(result.current.message).toContain("No pudimos subir el archivo");
    expect(result.current.phase).toBe("idle");
  });
});

describe("useImport — reintento (FR-030)", () => {
  function queueSuccessfulImport(id: string) {
    fetchMock
      .mockResolvedValueOnce(
        json({ importId: id, upload: { bucket: "imports", path: `u/${id}`, token: "t" } }, { status: 201 })
      )
      .mockResolvedValueOnce(json({ state: "parsing" }, { status: 202 }))
      .mockResolvedValueOnce(json(status({ id })));
  }

  it("retry() reutiliza el archivo en memoria y crea un import nuevo", async () => {
    queueSuccessfulImport("imp-1");
    queueSuccessfulImport("imp-2");
    const { result } = renderHook(() => useImport("kindle", null));

    await act(async () => result.current.start(file()));
    expect(result.current.status?.id).toBe("imp-1");

    await act(async () => result.current.retry());
    expect(result.current.status?.id).toBe("imp-2");
    const posts = fetchMock.mock.calls.filter(
      ([url, init]) => url === "/api/imports" && (init as RequestInit).method === "POST"
    );
    expect(posts).toHaveLength(2);
  });

  it("tras una recarga (estado inicial del servidor) no hay reintento posible", async () => {
    const { result } = renderHook(() =>
      useImport("kindle", status({ state: "error", errorCode: "ERR_IMPORT_5031" }))
    );
    expect(result.current.canRetry).toBe(false);
    await act(async () => result.current.retry());
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
