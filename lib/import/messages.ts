import type { DiscardReason, ImportSource } from "./types";

export type ErrorCode =
  | "ERR_IMPORT_4001"
  | "ERR_IMPORT_4002"
  | "ERR_IMPORT_4003"
  | "ERR_IMPORT_4004"
  | "ERR_IMPORT_4005"
  | "ERR_IMPORT_4006"
  | "ERR_IMPORT_5001"
  | "ERR_IMPORT_5031";

/** `format`: el problema es el archivo. `generic`: el problema es nuestro. */
export type ErrorKind = "format" | "generic";

interface ErrorEntry {
  kind: ErrorKind;
  title: string;
  body: (source: ImportSource) => string;
}

const FORMAT_TITLE = "No pudimos leer este archivo";
const GENERIC_TITLE = "Algo falló al importar";

export const ERROR_CATALOG: Record<ErrorCode, ErrorEntry> = {
  ERR_IMPORT_4001: {
    kind: "format",
    title: FORMAT_TITLE,
    body: () =>
      "El contenido no tiene el formato de My Clippings.txt. Puede ser que hayas subido otro archivo del lector, o que el archivo se haya editado.",
  },
  ERR_IMPORT_4002: {
    kind: "format",
    title: FORMAT_TITLE,
    body: () =>
      "Ese archivo no es una base de datos de Kobo. Buscá KoboReader.sqlite en la carpeta oculta .kobo del lector.",
  },
  ERR_IMPORT_4003: {
    kind: "format",
    title: FORMAT_TITLE,
    body: () =>
      "KoboReader.sqlite está dañado o quedó incompleto. Copialo de nuevo desde el lector.",
  },
  ERR_IMPORT_4004: {
    kind: "format",
    title: FORMAT_TITLE,
    body: () =>
      "Este KoboReader.sqlite tiene una estructura que no reconocemos. Puede ser de un firmware anterior a 2018.",
  },
  ERR_IMPORT_4005: {
    kind: "format",
    title: FORMAT_TITLE,
    body: (source) =>
      source === "kobo"
        ? "El archivo se leyó bien, pero no tiene ningún resaltado ni nota con texto."
        : "El archivo se leyó, pero no encontramos ningún resaltado válido.",
  },
  ERR_IMPORT_4006: {
    kind: "format",
    title: FORMAT_TITLE,
    body: () => "El archivo supera el máximo de 50 MB.",
  },
  ERR_IMPORT_5001: {
    kind: "generic",
    title: GENERIC_TITLE,
    body: () => "Ocurrió un error inesperado al procesar el archivo.",
  },
  ERR_IMPORT_5031: {
    kind: "generic",
    title: GENERIC_TITLE,
    body: () =>
      "El archivo se subió bien, pero el procesamiento se interrumpió antes de terminar.",
  },
};

export function isErrorCode(code: string | null | undefined): code is ErrorCode {
  return typeof code === "string" && code in ERROR_CATALOG;
}

/** 4xxx → `format`; 5xxx (y cualquier código desconocido) → `generic`. */
export function errorKind(code: string | null | undefined): ErrorKind {
  return isErrorCode(code) ? ERROR_CATALOG[code].kind : "generic";
}

export interface ErrorDescription {
  kind: ErrorKind;
  title: string;
  body: string;
  /** Frase fiel a lo persistido (FR-022 / FR-013). */
  savedNote: string;
}

/**
 * `saved` = true si algún lote llegó a persistirse. Sólo se afirma "no se guardó nada" cuando
 * es verdad: si un fallo ocurre a mitad, lo ya guardado se conserva (Principio I).
 */
export function describeError(
  code: string | null | undefined,
  opts: { saved: boolean; source?: ImportSource }
): ErrorDescription {
  const entry = isErrorCode(code) ? ERROR_CATALOG[code] : ERROR_CATALOG.ERR_IMPORT_5001;
  const kind = entry.kind;
  let savedNote: string;
  if (opts.saved) {
    savedNote = "Lo que ya se guardó se conserva. Podés reintentar sin duplicar.";
  } else if (kind === "format") {
    savedNote = "No se guardó nada de este intento.";
  } else {
    savedNote = "No se guardó nada, así que podés volver a intentar sin riesgo de duplicar.";
  }
  return { kind, title: entry.title, body: entry.body(opts.source ?? "kindle"), savedNote };
}

/** Texto completo que se persiste en `imports.error_message`. */
export function messageFor(
  code: ErrorCode,
  opts: { saved: boolean; source?: ImportSource }
): string {
  const d = describeError(code, opts);
  return `${d.body} ${d.savedNote}`;
}

const DISCARD_LABELS: Record<DiscardReason, [singular: string, plural: string]> = {
  bookmark_no_text: ["marcador sin texto", "marcadores sin texto"],
  empty_text: ["registro sin texto", "registros sin texto"],
  truncated: ["registro truncado", "registros truncados"],
  no_title: ["registro sin título de libro", "registros sin título de libro"],
  unknown_type: ["registro de tipo desconocido", "registros de tipo desconocido"],
  orphan_volume: ["anotación sin libro", "anotaciones sin libro"],
};

export function discardLabel(reason: DiscardReason, count: number): string {
  const [singular, plural] = DISCARD_LABELS[reason];
  return `${count} ${count === 1 ? singular : plural}`;
}

export function isDiscardReason(value: string): value is DiscardReason {
  return value in DISCARD_LABELS;
}
