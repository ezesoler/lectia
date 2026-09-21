"use client";

import { useId, useState } from "react";
import { describeError, discardLabel, isDiscardReason } from "@/lib/import/messages";
import type { ImportStatus } from "@/lib/import/types";
import { formatBytes, formatInt } from "./format";
import { WhereIsFile } from "./where-is-file";

interface Props {
  status: ImportStatus;
  onChooseFile: () => void;
}

/** Líneas del detalle técnico. Sólo cifras y la primera línea de un archivo que NO es un clippings. */
export function detailLines(status: ImportStatus): string[] {
  const d = status.errorDetails;
  const lines: string[] = [];
  if (d?.linesRead !== undefined) {
    lines.push(
      `${formatInt(d.linesRead)} líneas leídas · ${formatInt(d.validRecords ?? 0)} registros válidos`
    );
  }
  if (d?.expected && d.found) {
    lines.push(
      status.source === "kindle" && d.linesRead !== undefined
        ? `Línea 1: se esperaba «${d.expected}», se encontró «${d.found}»`
        : `Se esperaba «${d.expected}», se encontró «${d.found}»`
    );
  } else if (d?.found) {
    lines.push(d.found);
  }
  if (status.errorCode === "ERR_IMPORT_4001" && status.source === "kindle") {
    lines.push("No se encontró ningún separador «==========»");
  }
  if (status.discarded > 0) {
    for (const [reason, count] of Object.entries(status.discardBreakdown)) {
      if (isDiscardReason(reason) && count) lines.push(discardLabel(reason, count));
    }
  }
  return lines;
}

/**
 * Error de formato (mockups/estados-importar/01): el problema es el archivo. El detalle técnico
 * arranca plegado y nunca incluye texto de resaltados.
 */
export function ErrorFormatCard({ status, onChooseFile }: Props) {
  const saved = status.highlightsNew > 0;
  const info = describeError(status.errorCode, { saved, source: status.source });
  const [detailOpen, setDetailOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const detailId = useId();
  const helpId = useId();
  const lines = detailLines(status);

  return (
    <>
      <div className="lec-imp-alert" role="alert" data-testid="error-format">
        <div className="lec-imp-alert-row">
          <svg
            className="lec-imp-alert-icon"
            width="19"
            height="19"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 3.6 2.6 20h18.8L12 3.6Z" />
            <path d="M12 9.6v4.6" />
            <path d="M12 17.1h.01" />
          </svg>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span className="lec-imp-alert-title">{info.title}</span>
            <p className="lec-imp-alert-body">{info.body}</p>
          </div>
        </div>

        <div className="lec-imp-fileline">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            style={{ flex: "none", color: "var(--ink-2)" }}
          >
            <path d="M14 3.5H7a1.5 1.5 0 0 0-1.5 1.5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8L14 3.5Z" />
            <path d="M14 3.5V8h4.5" />
          </svg>
          <span className="lec-imp-fileline-name">{status.fileName}</span>
          {status.fileSize ? (
            <span className="lec-imp-fileline-size">{formatBytes(status.fileSize)}</span>
          ) : null}
        </div>

        {lines.length > 0 && (
          <div className="lec-imp-detail">
            <button
              type="button"
              className="lec-imp-link"
              aria-expanded={detailOpen}
              aria-controls={detailId}
              onClick={() => setDetailOpen((open) => !open)}
            >
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d={detailOpen ? "M6 15l6-6 6 6" : "M6 9l6 6 6-6"} />
              </svg>
              {detailOpen ? "Ocultar detalle" : "Ver detalle"}
            </button>
            <div id={detailId} hidden={!detailOpen}>
              {detailOpen && (
                <div className="lec-imp-detail-lines">
                  {lines.map((line) => (
                    <span key={line}>{line}</span>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="lec-imp-actions">
          <button type="button" className="lec-imp-btn lec-imp-btn-primary" onClick={onChooseFile}>
            Elegir otro archivo
          </button>
          <button
            type="button"
            className="lec-imp-btn lec-imp-btn-secondary"
            aria-expanded={helpOpen}
            aria-controls={helpId}
            onClick={() => setHelpOpen((open) => !open)}
          >
            Dónde está el archivo
          </button>
        </div>
        {helpOpen && <WhereIsFile source={status.source} id={helpId} />}
      </div>
      <span className="lec-imp-mono-note">
        {info.savedNote}
        {saved ? "" : " Tus resaltados anteriores siguen intactos."}
      </span>
    </>
  );
}
