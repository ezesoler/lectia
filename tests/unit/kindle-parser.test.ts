// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseClippings, parseKindleDate } from "@/lib/import/kindle-parser";

const fixture = (name: string) => readFileSync(resolve(__dirname, "../fixtures", name), "utf-8");

function clip(title: string, meta: string, text: string): string {
  return `${title}\r\n${meta}\r\n\r\n${text}\r\n==========\r\n`;
}

describe("parseClippings — fixtures", () => {
  it("clippings-es.txt: BOM, CRLF, 'La subrayado', autores con ; y Apellido, Nombre", () => {
    const r = parseClippings(fixture("clippings-es.txt"));

    expect(r.entries).toHaveLength(8);
    expect(r.discarded).toBe(2);
    expect(r.discardBreakdown).toEqual({ bookmark_no_text: 1, empty_text: 1 });
    expect(r.booksCount).toBe(4);

    const simpsons = r.entries.filter((e) => e.title.startsWith("Los Simpson"));
    expect(simpsons).toHaveLength(3);
    expect(simpsons[0]!.author).toBe("William Irwin, Mark T. Conard, Aeon J. Skoble");
    expect(simpsons.map((e) => e.kind)).toEqual(["highlight", "note", "highlight"]);
    expect(simpsons[0]).toMatchObject({ page: 2, location: "27-28" });

    const habitos = r.entries.find((e) => e.title === "Hábitos atómicos");
    expect(habitos?.author).toBe("James Clear");
  });

  it("clippings-es.txt: la fecha en español se interpreta", () => {
    const r = parseClippings(fixture("clippings-es.txt"));
    expect(r.entries[0]!.highlightedAt).toBe("2020-11-10T19:07:39.000Z");
  });

  it("clippings-en.txt: tipos, páginas, ubicaciones y fechas en inglés", () => {
    const r = parseClippings(fixture("clippings-en.txt"));

    expect(r.entries).toHaveLength(4);
    expect(r.discarded).toBe(1);
    expect(r.discardBreakdown).toEqual({ bookmark_no_text: 1 });
    expect(r.booksCount).toBe(2);
    expect(r.entries[1]).toMatchObject({ kind: "note", page: 12, location: "346" });
    expect(r.entries[0]!.highlightedAt).toBe("2025-03-03T10:23:45.000Z");
    expect(r.entries[2]!.highlightedAt).toBe("2024-06-14T16:05:09.000Z"); // 4:05 PM
    expect(r.entries[3]!.highlightedAt).toBe("2024-06-14T00:10:00.000Z"); // 12:10 AM
  });
});

describe("parseClippings — casos unitarios", () => {
  it("un paréntesis dentro del título no se confunde con el autor", () => {
    const r = parseClippings(
      clip("Dune (Edición especial) (Frank Herbert)", "- Your Highlight on page 1 | location 1-2 | Added on Monday, 3 March 2025 10:23:45 AM", "Texto")
    );
    expect(r.entries[0]).toMatchObject({ title: "Dune (Edición especial)", author: "Frank Herbert" });
  });

  it("sin autor entre paréntesis queda 'Autor desconocido'", () => {
    const r = parseClippings(
      clip("Un libro sin autor", "- Your Highlight on page 1 | location 1 | Added on Monday, 3 March 2025 10:23:45 AM", "Texto")
    );
    expect(r.entries[0]!.author).toBe("Autor desconocido");
  });

  it("invierte 'Apellido, Nombre'", () => {
    const r = parseClippings(
      clip("Cien años de soledad (García Márquez, Gabriel)", "- Your Highlight on page 1 | location 1 | Added on Monday, 3 March 2025 10:23:45 AM", "Texto")
    );
    expect(r.entries[0]!.author).toBe("Gabriel García Márquez");
  });

  it("detecta el tipo por la palabra clave aunque el artículo cambie", () => {
    const meta = (word: string) =>
      `- ${word} en la página 5 | posición 1-2 | Añadido el lunes, 5 de febrero de 2024 22:01:10`;
    const text = [
      clip("A (B)", meta("Tu subrayado"), "uno"),
      clip("A (B)", meta("La subrayado"), "dos"),
      clip("A (B)", meta("Mi nota"), "tres"),
    ].join("");
    const r = parseClippings(text);
    expect(r.entries.map((e) => e.kind)).toEqual(["highlight", "highlight", "note"]);
  });

  it("página y ubicación son opcionales: location queda ''", () => {
    const r = parseClippings(
      clip("A (B)", "- Your Highlight | Added on Monday, 3 March 2025 10:23:45 AM", "Sin página ni ubicación")
    );
    expect(r.entries[0]!.page).toBeUndefined();
    expect(r.entries[0]!.location).toBe("");
  });

  it("acepta \\n y \\r\\n y quita el BOM", () => {
    const lf = "﻿A (B)\n- Your Highlight on page 1 | location 1 | Added on Monday, 3 March 2025 10:23:45 AM\n\nTexto\n==========\n";
    const r = parseClippings(lf);
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]!.title).toBe("A");
  });

  it("un marcador no se guarda y suma a discarded como bookmark_no_text", () => {
    const r = parseClippings(
      clip("A (B)", "- Your Bookmark on page 1 | location 1 | Added on Monday, 3 March 2025 10:23:45 AM", "")
    );
    expect(r.entries).toEqual([]);
    expect(r.discarded).toBe(1);
    expect(r.discardBreakdown).toEqual({ bookmark_no_text: 1 });
  });

  it("un subrayado con texto vacío es empty_text", () => {
    const r = parseClippings(
      clip("A (B)", "- Your Highlight on page 1 | location 1 | Added on Monday, 3 March 2025 10:23:45 AM", "   ")
    );
    expect(r.discardBreakdown).toEqual({ empty_text: 1 });
  });

  it("clasifica truncado, sin título y tipo desconocido", () => {
    const text =
      "Solo un titulo (Autor)\r\n==========\r\n" +
      "- Your Highlight on page 1 | location 1 | Added on Monday, 3 March 2025 10:23:45 AM\r\n\r\nSin título\r\n==========\r\n" +
      clip("A (B)", "- Algo rarísimo en la página 1 | posición 1", "Texto");
    const r = parseClippings(text);
    expect(r.discardBreakdown).toEqual({ truncated: 1, no_title: 1, unknown_type: 1 });
    expect(r.discarded).toBe(3);
  });

  it("una fecha ilegible no descarta la entrada", () => {
    const r = parseClippings(
      clip("A (B)", "- Your Highlight on page 1 | location 1 | Added on ¿cuándo?", "Texto")
    );
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]!.highlightedAt).toBeUndefined();
  });

  it("un archivo sin separadores no es un clippings: entries vacío y sin descartes", () => {
    const r = parseClippings("# Resaltados exportados\nLínea 2\nLínea 3\n");
    expect(r.entries).toEqual([]);
    expect(r.discarded).toBe(0);
    expect(r.linesRead).toBe(3);
    expect(r.firstLine).toBe("# Resaltados exportados");
  });

  it("entrada vacía → sin entradas", () => {
    const r = parseClippings("");
    expect(r).toMatchObject({ entries: [], discarded: 0, booksCount: 0 });
  });
});

describe("parseKindleDate", () => {
  it("interpreta español, inglés, portugués, francés, alemán e italiano", () => {
    expect(parseKindleDate("martes, 10 de noviembre de 2020 19:07:39")).toBe("2020-11-10T19:07:39.000Z");
    expect(parseKindleDate("Monday, March 3, 2025 10:23:45 AM")).toBe("2025-03-03T10:23:45.000Z");
    expect(parseKindleDate("terça-feira, 10 de novembro de 2020 19:07:39")).toBe("2020-11-10T19:07:39.000Z");
    expect(parseKindleDate("mardi 10 novembre 2020 19:07:39")).toBe("2020-11-10T19:07:39.000Z");
    expect(parseKindleDate("Dienstag, 10. November 2020 19:07:39")).toBe("2020-11-10T19:07:39.000Z");
    expect(parseKindleDate("martedì 10 novembre 2020 19:07:39")).toBe("2020-11-10T19:07:39.000Z");
  });

  it("'martes' no se confunde con marzo", () => {
    expect(parseKindleDate("martes, 10 de febrero de 2021 1:00:00")).toBe("2021-02-10T01:00:00.000Z");
  });

  it("devuelve undefined si no se entiende", () => {
    expect(parseKindleDate("ayer")).toBeUndefined();
  });
});

describe("parseClippings — archivos parciales y otros idiomas (US4)", () => {
  it("clippings-broken.txt: 90 válidas y 10 descartadas con su motivo (SC-005)", () => {
    const r = parseClippings(fixture("clippings-broken.txt"));
    expect(r.entries).toHaveLength(90);
    expect(r.discarded).toBe(10);
    expect(r.discardBreakdown).toEqual({
      bookmark_no_text: 6,
      truncated: 2,
      no_title: 1,
      empty_text: 1,
    });
    expect(r.entries.length + r.discarded).toBe(100);
    expect(r.booksCount).toBe(5);
  });

  it("clippings-all-invalid.txt: hay estructura pero ninguna entrada válida", () => {
    const r = parseClippings(fixture("clippings-all-invalid.txt"));
    expect(r.entries).toEqual([]);
    expect(r.discarded).toBe(5);
    expect(r.discardBreakdown).toEqual({
      truncated: 2,
      no_title: 1,
      bookmark_no_text: 1,
      unknown_type: 1,
    });
  });

  it("clippings-not-clippings.txt: sin separadores es 'no es un clippings' (sin descartes)", () => {
    const r = parseClippings(fixture("clippings-not-clippings.txt"));
    expect(r.entries).toEqual([]);
    expect(r.discarded).toBe(0);
    expect(r.linesRead).toBe(8);
    expect(r.firstLine).toBe("# Resaltados exportados");
  });

  it("clippings-multilang.txt: pt, fr, de, it, ja y árabe se leen sin descartar nada", () => {
    const r = parseClippings(fixture("clippings-multilang.txt"));
    expect(r.discarded).toBe(0);
    expect(r.entries).toHaveLength(6);
    expect(r.entries.map((e) => e.kind)).toEqual(Array(6).fill("highlight"));
    expect(r.entries.map((e) => e.page)).toEqual([5, 6, 7, 8, 9, 10]);
    expect(r.entries.map((e) => e.location)).toEqual([
      "100-101",
      "110-111",
      "120-121",
      "130-131",
      "140-141",
      "150-151",
    ]);
  });

  it("clippings-multilang.txt: fechas por idioma; en japonés no se interpreta y no descarta", () => {
    const r = parseClippings(fixture("clippings-multilang.txt"));
    expect(r.entries.map((e) => e.highlightedAt)).toEqual([
      "2020-11-10T19:07:39.000Z",
      "2020-11-10T19:08:39.000Z",
      "2020-11-10T19:09:39.000Z",
      "2020-11-10T19:10:39.000Z",
      undefined,
      "2020-11-10T19:12:39.000Z",
    ]);
  });

  it("los textos en japonés y árabe se guardan tal cual, sin normalizar", () => {
    const r = parseClippings(fixture("clippings-multilang.txt"));
    expect(r.entries[4]!.text).toContain("日本語の文章はそのまま保存されます。");
    expect(r.entries[5]!.text).toBe("النص العربي يُحفَظ كما هو مع الحركات: كِتَاب");
    expect(r.entries[5]!.title).toBe("كتاب");
  });
});
