import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImportScreen } from "@/components/import/import-screen";
import { SourceCard } from "@/components/import/source-card";
import type { ImportController, ImportPhase } from "@/components/import/use-import";
import type { ImportSource, ImportStatus } from "@/lib/import/types";

function status(over: Partial<ImportStatus> = {}): ImportStatus {
  return {
    id: "imp-1",
    source: "kindle",
    state: "done",
    fileName: "My Clippings.txt",
    fileSize: 88_397,
    entriesTotal: 100,
    entriesDone: 100,
    booksCount: 4,
    highlightsNew: 59,
    highlightsDup: 0,
    discarded: 0,
    discardBreakdown: {},
    errorCode: null,
    errorMessage: null,
    errorDetails: null,
    startedAt: "2026-09-21T12:00:00Z",
    finishedAt: "2026-09-21T12:00:30Z",
    ...over,
  };
}

function controller(
  phase: ImportPhase,
  st: ImportStatus | null,
  over: Partial<ImportController> = {}
): ImportController {
  return {
    source: (st?.source ?? "kindle") as ImportSource,
    phase,
    status: st,
    message: null,
    pendingFile: null,
    canRetry: false,
    start: vi.fn(async () => undefined),
    retry: vi.fn(async () => undefined),
    dismissMessage: vi.fn(),
    ...over,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SourceCard — idle / parsing / done", () => {
  it("idle: zona de arrastre, botón de 'Elegir archivo' y la ayuda de carpeta de cada origen", () => {
    const { rerender } = render(<SourceCard controller={controller("idle", null)} />);
    expect(screen.getByRole("button", { name: "Elegir archivo" })).toBeTruthy();
    expect(screen.getByText("documents")).toBeTruthy();

    rerender(<SourceCard controller={controller("idle", null, { source: "kobo" })} />);
    expect(screen.getByText("KoboReader.sqlite", { selector: "span.lec-imp-chip" })).toBeTruthy();
    expect(screen.getByText(".kobo")).toBeTruthy();
    expect(screen.getByText(/carpeta oculta/)).toBeTruthy();
  });

  it("parsing determinado: porcentaje y recuento parcial de resaltados", () => {
    render(
      <SourceCard
        controller={controller(
          "parsing",
          status({ state: "parsing", entriesTotal: 3000, entriesDone: 1110, highlightsNew: 1100, highlightsDup: 10 })
        )}
      />
    );
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("37");
    expect(screen.getByText("Procesando · 37 %")).toBeTruthy();
    expect(screen.getByText("1.110")).toBeTruthy();
    expect(screen.getByText(/resaltados encontrados/)).toBeTruthy();
  });

  it("parsing indeterminado cuando todavía no se conoce el total", () => {
    render(
      <SourceCard controller={controller("parsing", status({ state: "parsing", entriesTotal: 0, entriesDone: 0 }))} />
    );
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBeNull();
    expect(bar.className).toContain("is-indeterminate");
    expect(screen.getByText("Leyendo el archivo…")).toBeTruthy();
  });

  it("uploading: barra indeterminada con nombre y tamaño del archivo", () => {
    render(
      <SourceCard
        controller={controller("uploading", null, { pendingFile: { name: "My Clippings.txt", size: 88_397 } })}
      />
    );
    expect(screen.getByText("Subiendo archivo…")).toBeTruthy();
    expect(screen.getByText("My Clippings.txt", { selector: ".lec-imp-progress-file span" })).toBeTruthy();
    expect(screen.getByText("86 KB")).toBeTruthy();
  });

  it("done: resumen exacto, 'listo', nuevos y ya existentes", () => {
    render(
      <SourceCard
        controller={controller("done", status({ booksCount: 4, highlightsNew: 10, highlightsDup: 50 }))}
      />
    );
    expect(screen.getByTestId("summary-kindle").textContent).toContain("4 libros · 60 resaltados");
    expect(screen.getByText("listo")).toBeTruthy();
    expect(screen.getByText(/10 nuevos · 50 ya estaban/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reemplazar archivo" })).toBeTruthy();
    expect(screen.queryByTestId("partial-notice")).toBeNull();
  });

  it("done usa el singular", () => {
    render(<SourceCard controller={controller("done", status({ booksCount: 1, highlightsNew: 1 }))} />);
    expect(screen.getByTestId("summary-kindle").textContent).toContain("1 libro · 1 resaltado");
  });

  it("muestra el mensaje inline (validación, importación en curso)", () => {
    render(<SourceCard controller={controller("idle", null, { message: "El archivo está vacío." })} />);
    expect(screen.getByRole("alert").textContent).toBe("El archivo está vacío.");
  });
});

describe("SourceCard — error genérico (US3)", () => {
  const generic = (over: Partial<ImportStatus> = {}) =>
    status({
      state: "error",
      source: "kobo",
      fileName: "KoboReader.sqlite",
      fileSize: 19_300_000,
      errorCode: "ERR_IMPORT_5031",
      highlightsNew: 0,
      finishedAt: "2026-09-21T09:41:00",
      ...over,
    });

  it("muestra título, código, archivo · tamaño y 'Reintentar' como acción primaria", () => {
    render(<SourceCard controller={controller("error", generic(), { source: "kobo", canRetry: true })} />);
    const panel = screen.getByTestId("error-generic");
    expect(within(panel).getByText("Algo falló al importar")).toBeTruthy();
    expect(within(panel).getByText("ERR_IMPORT_5031")).toBeTruthy();
    expect(within(panel).getByText(/KoboReader\.sqlite · 18,4 MB/)).toBeTruthy();
    expect(within(panel).getByRole("button", { name: "Reintentar" })).toBeTruthy();
    expect(within(panel).getByRole("button", { name: "Elegir otro archivo" })).toBeTruthy();
  });

  it("sin archivo en memoria (tras recargar) sólo ofrece 'Elegir otro archivo'", () => {
    render(<SourceCard controller={controller("error", generic(), { source: "kobo", canRetry: false })} />);
    expect(screen.queryByRole("button", { name: "Reintentar" })).toBeNull();
    expect(screen.getByRole("button", { name: "Elegir otro archivo" })).toBeTruthy();
  });

  it("'Reintentar' llama al controlador", () => {
    const c = controller("error", generic(), { source: "kobo", canRetry: true });
    render(<SourceCard controller={c} />);
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(c.retry).toHaveBeenCalledTimes(1);
  });

  it("'Copiar código' copia el código y lo anuncia", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    render(<SourceCard controller={controller("error", generic(), { source: "kobo" })} />);

    fireEvent.click(screen.getByRole("button", { name: "Copiar código" }));

    await screen.findByText("Código copiado");
    expect(writeText).toHaveBeenCalledWith("ERR_IMPORT_5031");
  });

  it("afirma 'No se guardó nada' sólo si no se persistió ningún lote", () => {
    const { unmount } = render(
      <SourceCard controller={controller("error", generic({ highlightsNew: 0 }), { source: "kobo" })} />
    );
    expect(screen.getByTestId("error-generic").textContent).toContain("No se guardó nada");
    expect(screen.getByTestId("error-generic").textContent).not.toContain("se conserva");
    unmount();

    render(<SourceCard controller={controller("error", generic({ highlightsNew: 120 }), { source: "kobo" })} />);
    expect(screen.getByTestId("error-generic").textContent).toContain("Lo que ya se guardó se conserva");
    expect(screen.getByTestId("error-generic").textContent).not.toContain("No se guardó nada");
  });
});

describe("SourceCard — importación parcial (US4)", () => {
  const partial = status({
    discarded: 12,
    discardBreakdown: { bookmark_no_text: 9, truncated: 2, no_title: 1 },
  });

  it("es 'done' con aviso: mantiene chip y 'listo', y muestra el desglose expandido", () => {
    render(<SourceCard controller={controller("done", partial)} />);
    expect(screen.getByText("listo")).toBeTruthy();
    const notice = screen.getByTestId("partial-notice");
    expect(within(notice).getByText("12 registros quedaron afuera")).toBeTruthy();
    expect(within(notice).getByText("9 marcadores sin texto")).toBeTruthy();
    expect(within(notice).getByText("2 registros truncados")).toBeTruthy();
    expect(within(notice).getByText("1 registro sin título de libro")).toBeTruthy();
    expect(screen.queryByTestId("error-format")).toBeNull();
  });

  it("no ofrece 'Descargar el detalle' (fuera de alcance)", () => {
    render(<SourceCard controller={controller("done", partial)} />);
    expect(screen.queryByText(/Descargar el detalle/)).toBeNull();
  });

  it("usa el singular con un solo descarte", () => {
    render(
      <SourceCard
        controller={controller("done", status({ discarded: 1, discardBreakdown: { empty_text: 1 } }))}
      />
    );
    expect(screen.getByText("1 registro quedó afuera")).toBeTruthy();
  });
});

describe("SourceCard — error de formato (US4)", () => {
  const format = (over: Partial<ImportStatus> = {}) =>
    status({
      state: "error",
      fileName: "notas-kindle-backup.txt",
      fileSize: 88_000,
      errorCode: "ERR_IMPORT_4001",
      highlightsNew: 0,
      errorDetails: {
        linesRead: 1284,
        validRecords: 0,
        expected: "Título (Autor)",
        found: "# Resaltados exportados",
      },
      ...over,
    });

  it("muestra el título del mockup, archivo y tamaño, y no ofrece 'Reintentar'", () => {
    render(<SourceCard controller={controller("error", format(), { canRetry: true })} />);
    const panel = screen.getByTestId("error-format");
    expect(within(panel).getByText("No pudimos leer este archivo")).toBeTruthy();
    expect(within(panel).getByText("notas-kindle-backup.txt")).toBeTruthy();
    expect(within(panel).getByText("86 KB")).toBeTruthy();
    expect(within(panel).getByRole("button", { name: "Elegir otro archivo" })).toBeTruthy();
    expect(within(panel).queryByRole("button", { name: "Reintentar" })).toBeNull();
  });

  it("el detalle técnico está plegado por defecto y se despliega", () => {
    render(<SourceCard controller={controller("error", format())} />);
    expect(screen.queryByText(/líneas leídas/)).toBeNull();
    const toggle = screen.getByRole("button", { name: "Ver detalle" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(toggle);

    expect(screen.getByText("1.284 líneas leídas · 0 registros válidos")).toBeTruthy();
    expect(
      screen.getByText("Línea 1: se esperaba «Título (Autor)», se encontró «# Resaltados exportados»")
    ).toBeTruthy();
    expect(screen.getByText("No se encontró ningún separador «==========»")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ocultar detalle" })).toBeTruthy();
  });

  it("'Dónde está el archivo' abre la ayuda del origen", () => {
    render(<SourceCard controller={controller("error", format())} />);
    expect(screen.queryByText(/My Clippings\.txt/, { selector: "strong" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Dónde está el archivo" }));
    expect(screen.getByText("My Clippings.txt", { selector: "strong" })).toBeTruthy();
    expect(screen.getByText("documents", { selector: "strong" })).toBeTruthy();
  });

  it("la nota final dice 'No se guardó nada de este intento' y que lo anterior sigue intacto", () => {
    render(<SourceCard controller={controller("error", format())} />);
    expect(screen.getByText(/No se guardó nada de este intento\. Tus resaltados anteriores siguen intactos\./)).toBeTruthy();
  });

  it("si algo se guardó antes del fallo no afirma que no se guardó nada", () => {
    render(<SourceCard controller={controller("error", format({ highlightsNew: 30 }))} />);
    expect(screen.queryByText(/No se guardó nada/)).toBeNull();
    expect(screen.getByText(/Lo que ya se guardó se conserva/)).toBeTruthy();
  });
});

describe("ImportScreen — 'Ver mi biblioteca' (FR-023)", () => {
  it("deshabilitado mientras ningún origen esté en done", () => {
    render(<ImportScreen initial={{ kindle: null, kobo: null }} />);
    const cta = screen.getByTestId("cta-library");
    expect(cta.getAttribute("aria-disabled")).toBe("true");
    expect(cta.tagName).toBe("BUTTON");
    expect(screen.getByText("Ningún origen importado todavía")).toBeTruthy();
  });

  it("habilitado (enlace a /) en cuanto un origen terminó, y lo nombra", () => {
    render(<ImportScreen initial={{ kindle: status(), kobo: null }} />);
    const cta = screen.getByTestId("cta-library");
    expect(cta.tagName).toBe("A");
    expect(cta.getAttribute("href")).toBe("/");
    expect(cta.getAttribute("aria-disabled")).toBeNull();
    expect(screen.getByText("Kindle listo")).toBeTruthy();
  });

  it("un origen en error no habilita el botón", () => {
    render(
      <ImportScreen
        initial={{ kindle: status({ state: "error", errorCode: "ERR_IMPORT_4001" }), kobo: null }}
      />
    );
    expect(screen.getByTestId("cta-library").getAttribute("aria-disabled")).toBe("true");
  });
});
