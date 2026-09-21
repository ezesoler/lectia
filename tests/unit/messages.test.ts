// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  describeError,
  discardLabel,
  errorKind,
  messageFor,
} from "@/lib/import/messages";

describe("errorKind", () => {
  it("4xxx es de formato y 5xxx genérico", () => {
    expect(errorKind("ERR_IMPORT_4001")).toBe("format");
    expect(errorKind("ERR_IMPORT_4005")).toBe("format");
    expect(errorKind("ERR_IMPORT_5031")).toBe("generic");
  });

  it("un código desconocido o nulo se trata como genérico", () => {
    expect(errorKind("ERR_IMPORT_9999")).toBe("generic");
    expect(errorKind(null)).toBe("generic");
  });
});

describe("messageFor", () => {
  it("afirma que no se guardó nada sólo cuando no se persistió ningún lote", () => {
    const sinGuardar = messageFor("ERR_IMPORT_5031", { saved: false });
    expect(sinGuardar).toContain("No se guardó nada");
    expect(sinGuardar).not.toContain("se conserva");
  });

  it("si ya se guardó algo, dice que se conserva y que reintentar no duplica", () => {
    const guardado = messageFor("ERR_IMPORT_5031", { saved: true });
    expect(guardado).toContain("Lo que ya se guardó se conserva");
    expect(guardado).toContain("sin duplicar");
    expect(guardado).not.toContain("No se guardó nada");
  });

  it("el error de formato usa la frase corta del mockup", () => {
    expect(messageFor("ERR_IMPORT_4001", { saved: false })).toContain(
      "No se guardó nada de este intento."
    );
  });
});

describe("describeError", () => {
  it("usa los títulos de los mockups", () => {
    expect(describeError("ERR_IMPORT_4001", { saved: false }).title).toBe(
      "No pudimos leer este archivo"
    );
    expect(describeError("ERR_IMPORT_5031", { saved: false }).title).toBe(
      "Algo falló al importar"
    );
  });

  it("4005 cambia el cuerpo según el origen", () => {
    expect(describeError("ERR_IMPORT_4005", { saved: false, source: "kobo" }).body).toContain(
      "nota"
    );
  });
});

describe("discardLabel", () => {
  it("respeta singular y plural", () => {
    expect(discardLabel("bookmark_no_text", 9)).toBe("9 marcadores sin texto");
    expect(discardLabel("no_title", 1)).toBe("1 registro sin título de libro");
    expect(discardLabel("truncated", 2)).toBe("2 registros truncados");
  });
});
