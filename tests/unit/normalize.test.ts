// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  buildKeys,
  canonicalizeKindleAuthor,
  hashHighlight,
  normalize,
} from "@/lib/import/normalize";

describe("normalize", () => {
  it("quita acentos latinos, mayúsculas y puntuación", () => {
    expect(normalize("  La Generación  Ansiosa: ¿Cómo?  ")).toBe("la generacion ansiosa como");
    expect(normalize("El niño")).toBe("el nino");
  });

  it("no le quita la dakuten al japonés", () => {
    expect(normalize("が")).toBe("が");
    expect(normalize("が")).not.toBe(normalize("か"));
  });

  it("conserva las marcas combinantes de árabe y devanagari", () => {
    expect(normalize("كِتَاب")).toBe("كِتَاب");
    expect(normalize("हिन्दी")).toBe("हिन्दी");
  });

  it("devuelve cadena vacía si sólo hay signos", () => {
    expect(normalize("¡¿ — … !?")).toBe("");
  });

  it("colapsa espacios", () => {
    expect(normalize("a\t\n b   c")).toBe("a b c");
  });
});

describe("buildKeys", () => {
  it("calcula claves de título y autor", () => {
    expect(buildKeys("Hábitos atómicos", "James Clear")).toEqual({
      titleKey: "habitos atomicos",
      authorKey: "james clear",
    });
  });
});

describe("canonicalizeKindleAuthor", () => {
  it("invierte Apellido, Nombre", () => {
    expect(canonicalizeKindleAuthor("García Márquez, Gabriel")).toBe("Gabriel García Márquez");
  });

  it("separa varios autores unidos por ; sin espacio (caso real)", () => {
    const author = canonicalizeKindleAuthor("William Irwin;Mark T. Conard;Aeon J. Skoble");
    expect(author).toBe("William Irwin, Mark T. Conard, Aeon J. Skoble");
    expect(normalize(author)).toBe("william irwin mark t conard aeon j skoble");
  });

  it("no invierte sufijos como Jr.", () => {
    expect(canonicalizeKindleAuthor("Martin Luther King, Jr.")).toBe("Martin Luther King, Jr.");
  });

  it("deja igual un autor sin coma", () => {
    expect(canonicalizeKindleAuthor("Jonathan Haidt")).toBe("Jonathan Haidt");
  });
});

describe("hashHighlight", () => {
  const base = {
    titleKey: "t",
    authorKey: "a",
    kind: "highlight" as const,
    textKey: "hola mundo",
    location: "10-11",
  };

  it("es determinista y hexadecimal de 64 caracteres", () => {
    expect(hashHighlight(base)).toBe(hashHighlight({ ...base }));
    expect(hashHighlight(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("evita la colisión por concatenación ambigua", () => {
    const a = hashHighlight({ ...base, titleKey: "ab", authorKey: "c" });
    const b = hashHighlight({ ...base, titleKey: "a", authorKey: "bc" });
    expect(a).not.toBe(b);
  });

  it("distingue una nota de un subrayado con el mismo texto y ubicación", () => {
    expect(hashHighlight(base)).not.toBe(hashHighlight({ ...base, kind: "note" }));
  });

  it("distingue la ubicación", () => {
    expect(hashHighlight(base)).not.toBe(hashHighlight({ ...base, location: "" }));
  });
});
