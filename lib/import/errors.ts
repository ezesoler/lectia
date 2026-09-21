import type { ErrorCode } from "./messages";
import type { ErrorDetails } from "./types";

/** Fallo del procesamiento con código de error ya resuelto (catálogo en messages.ts). */
export class ImportFailure extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly details?: ErrorDetails,
    message?: string
  ) {
    super(message ?? code);
    this.name = "ImportFailure";
  }
}

export type KoboErrorCode = "not_sqlite" | "corrupt" | "unsupported_schema" | "empty";

/** Lanzado por el parser de Kobo; run-import lo traduce a un código ERR_IMPORT_xxxx. */
export class KoboFileError extends Error {
  constructor(
    public readonly code: KoboErrorCode,
    message?: string
  ) {
    super(message ?? code);
    this.name = "KoboFileError";
  }
}

export const KOBO_ERROR_TO_CODE: Record<KoboErrorCode, ErrorCode> = {
  not_sqlite: "ERR_IMPORT_4002",
  corrupt: "ERR_IMPORT_4003",
  unsupported_schema: "ERR_IMPORT_4004",
  empty: "ERR_IMPORT_4005",
};
