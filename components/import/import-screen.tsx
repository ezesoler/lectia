"use client";

import Link from "next/link";
import type { ImportStatus } from "@/lib/import/types";
import "./import.css";
import { SourceCard } from "./source-card";
import { useImport } from "./use-import";

export interface InitialImports {
  kindle: ImportStatus | null;
  kobo: ImportStatus | null;
}

export function ImportScreen({ initial }: { initial: InitialImports }) {
  const kindle = useImport("kindle", initial.kindle);
  const kobo = useImport("kobo", initial.kobo);

  const ready = [
    kindle.phase === "done" ? "Kindle" : null,
    kobo.phase === "done" ? "Kobo" : null,
  ].filter((name): name is string => name !== null);
  const canContinue = ready.length > 0;

  const statusText = !canContinue
    ? "Ningún origen importado todavía"
    : ready.length === 1
      ? `${ready[0]} listo`
      : `${ready.join(" y ")} listos`;

  return (
    <div className="lec-imp">
      <div className="lec-imp-head">
        <div className="lec-imp-kicker">
          <span className="lec-imp-kicker-bar" aria-hidden="true" />
          <span className="lec-imp-kicker-text">Paso 1 de 1 · Importar</span>
        </div>
        <h2 className="lec-imp-title">Traé tus resaltados</h2>
        <p className="lec-imp-lead">
          <span className="lec-imp-lead-mobile">
            Conectá el lector por cable o abrí el archivo desde iCloud. Podés importar los dos y en
            cualquier orden.
          </span>
          <span className="lec-imp-lead-desktop">
            Conectá el lector por cable y arrastrá el archivo. Podés importar los dos y en cualquier
            orden.
          </span>
        </p>
      </div>

      <div className="lec-imp-grid">
        <SourceCard controller={kindle} />
        <SourceCard controller={kobo} />
      </div>

      <div className="lec-imp-foot">
        <span className="lec-imp-foot-status">{statusText}</span>
        {canContinue ? (
          <Link href="/" className="lec-imp-cta" data-testid="cta-library">
            Ver mi biblioteca
          </Link>
        ) : (
          <button
            type="button"
            className="lec-imp-cta"
            aria-disabled="true"
            onClick={(e) => e.preventDefault()}
            data-testid="cta-library"
          >
            Ver mi biblioteca
          </button>
        )}
      </div>
    </div>
  );
}
