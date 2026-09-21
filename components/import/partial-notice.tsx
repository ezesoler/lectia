import { discardLabel, isDiscardReason } from "@/lib/import/messages";
import type { ImportStatus } from "@/lib/import/types";
import { formatInt } from "./format";

/**
 * Aviso de importación parcial (mockups/estados-importar/03): no es un error. El desglose se
 * muestra siempre expandido porque es la explicación del número. Sin "Descargar el detalle"
 * (fuera de alcance).
 */
export function PartialNotice({ status }: { status: ImportStatus }) {
  const reasons = Object.entries(status.discardBreakdown).filter(
    (entry): entry is [Parameters<typeof discardLabel>[0], number] =>
      isDiscardReason(entry[0]) && typeof entry[1] === "number" && entry[1] > 0
  );
  const n = status.discarded;
  const hasBookmarks = (status.discardBreakdown.bookmark_no_text ?? 0) > 0;

  return (
    <div className="lec-imp-notice" data-testid="partial-notice">
      <div className="lec-imp-notice-row">
        <svg
          className="lec-imp-alert-icon"
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9.2" />
          <path d="M12 7.6v5" />
          <path d="M12 16.2h.01" />
        </svg>
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span className="lec-imp-notice-title">
            {n === 1 ? "1 registro quedó afuera" : `${formatInt(n)} registros quedaron afuera`}
          </span>
          <p className="lec-imp-notice-body">
            El resto se importó sin problemas.
            {hasBookmarks ? " Los marcadores no tienen texto, así que no se guardan." : ""}
          </p>
        </div>
      </div>
      {reasons.length > 0 && (
        <ul className="lec-imp-breakdown">
          {reasons.map(([reason, count]) => (
            <li key={reason}>{discardLabel(reason, count)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
