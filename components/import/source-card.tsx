"use client";

import { useId, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { errorKind } from "@/lib/import/messages";
import { ErrorFormatCard } from "./error-format-card";
import { ErrorGenericCard } from "./error-generic-card";
import {
  formatBytes,
  formatInt,
  SOURCE_EXTENSION,
  SOURCE_FILE,
  SOURCE_LABEL,
} from "./format";
import { PartialNotice } from "./partial-notice";
import type { ImportController } from "./use-import";

const HELP: Record<"kindle" | "kobo", { folder: string; where: string }> = {
  kindle: { folder: "documents", where: "Está en la carpeta" },
  kobo: { folder: ".kobo", where: "Está en la carpeta oculta" },
};

export function SourceCard({ controller }: { controller: ImportController }) {
  const { source, phase, status, message, pendingFile, canRetry } = controller;
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const headingId = useId();
  const label = SOURCE_LABEL[source];
  const fileName = SOURCE_FILE[source];

  const openPicker = () => inputRef.current?.click();

  function onChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // permite volver a elegir el mismo archivo
    if (file) void controller.start(file);
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setOver(false);
    const file = e.dataTransfer.files[0];
    if (file) void controller.start(file);
  }

  const percent =
    status && status.entriesTotal > 0
      ? Math.min(100, Math.round((status.entriesDone / status.entriesTotal) * 100))
      : null;
  const found = status ? status.highlightsNew + status.highlightsDup : 0;
  const shownFile =
    status && phase === "parsing" ? { name: status.fileName, size: status.fileSize } : pendingFile;

  return (
    <section
      className="lec-imp-card"
      aria-labelledby={headingId}
      data-testid={`card-${source}`}
      data-phase={phase}
    >
      <div className="lec-imp-card-head">
        <h3 id={headingId} className="lec-imp-card-name" style={{ margin: 0 }}>
          {label}
        </h3>
        <span className={`lec-imp-chip lec-imp-chip-${source}`}>{fileName}</span>
      </div>

      <div className="lec-imp-card-body" aria-live="polite">
        {phase === "idle" && (
          <>
            <div
              className={`lec-imp-drop${over ? " is-over" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(true);
              }}
              onDragLeave={() => setOver(false)}
              onDrop={onDrop}
              data-testid={`dropzone-${source}`}
            >
              <svg
                className="lec-imp-drop-icon"
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 3v12" />
                <path d="M7 10l5 5 5-5" />
                <path d="M4 20h16" />
              </svg>
              <span className="lec-imp-drop-text">
                <span className="lec-imp-drop-text-mobile">Todavía sin archivo de {label}</span>
                <span className="lec-imp-drop-text-desktop">
                  Arrastrá <strong>{fileName}</strong> acá
                </span>
              </span>
              <button type="button" className="lec-imp-btn lec-imp-btn-choose" onClick={openPicker}>
                Elegir archivo
              </button>
            </div>
            <span className="lec-imp-mono-note">
              {HELP[source].where} <strong>{HELP[source].folder}</strong> del lector.
            </span>
          </>
        )}

        {(phase === "uploading" || phase === "parsing") && (
          <div className="lec-imp-progress" data-testid={`progress-${source}`}>
            {shownFile && (
              <div className="lec-imp-progress-file">
                <span>{shownFile.name}</span>
                {shownFile.size ? <span>{formatBytes(shownFile.size)}</span> : null}
              </div>
            )}
            <div
              className={`lec-imp-track${percent === null || phase === "uploading" ? " is-indeterminate" : ""}`}
              role="progressbar"
              aria-label={`Importando ${label}`}
              aria-valuemin={0}
              aria-valuemax={100}
              {...(percent !== null && phase === "parsing" ? { "aria-valuenow": percent } : {})}
            >
              <div
                className="lec-imp-fill"
                style={percent !== null && phase === "parsing" ? { width: `${percent}%` } : undefined}
              />
            </div>
            <div className="lec-imp-progress-meta">
              <span>
                {phase === "uploading"
                  ? "Subiendo archivo…"
                  : percent === null
                    ? "Leyendo el archivo…"
                    : `Procesando · ${percent} %`}
              </span>
              {phase === "parsing" && percent !== null && (
                <span>
                  <strong>{formatInt(found)}</strong> resaltados encontrados
                </span>
              )}
            </div>
          </div>
        )}

        {phase === "done" && status && (
          <>
            <div className="lec-imp-summary" data-testid={`summary-${source}`}>
              <span className="lec-imp-summary-text">
                {formatInt(status.booksCount)} {status.booksCount === 1 ? "libro" : "libros"} ·{" "}
                {formatInt(status.highlightsNew + status.highlightsDup)}{" "}
                {status.highlightsNew + status.highlightsDup === 1 ? "resaltado" : "resaltados"}
              </span>
              <span className="lec-imp-summary-ok">listo</span>
            </div>
            <span className="lec-imp-mono-note">
              {formatInt(status.highlightsNew)} nuevos
              {status.highlightsDup > 0 ? ` · ${formatInt(status.highlightsDup)} ya estaban` : ""}
            </span>
            {status.discarded > 0 && <PartialNotice status={status} />}
            <button type="button" className="lec-imp-btn lec-imp-btn-ghost" onClick={openPicker}>
              Reemplazar archivo
            </button>
          </>
        )}

        {phase === "error" && status && (
          <>
            {errorKind(status.errorCode) === "format" ? (
              <ErrorFormatCard status={status} onChooseFile={openPicker} />
            ) : (
              <ErrorGenericCard
                status={status}
                canRetry={canRetry}
                onRetry={() => void controller.retry()}
                onChooseFile={openPicker}
              />
            )}
          </>
        )}

        {message && (
          <p className="lec-imp-msg" role="alert" data-testid={`message-${source}`}>
            {message}
          </p>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        className="lec-imp-file-input"
        accept={SOURCE_EXTENSION[source]}
        onChange={onChange}
        tabIndex={-1}
        aria-label={`Elegir ${fileName}`}
        data-testid={`file-input-${source}`}
      />
    </section>
  );
}
