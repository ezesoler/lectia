"use client";

import { useEffect, useRef, useState } from "react";
import { describeError } from "@/lib/import/messages";
import type { ImportStatus } from "@/lib/import/types";
import { formatBytes, formatDateTime } from "./format";

interface Props {
  status: ImportStatus;
  canRetry: boolean;
  onRetry: () => void;
  onChooseFile: () => void;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Sin Clipboard API (http, permisos): selección temporal + execCommand
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(area);
      return ok;
    } catch {
      return false;
    }
  }
}

/**
 * Error genérico (mockups/estados-importar/02): el problema es nuestro, no del archivo.
 * Ícono de círculo (no de triángulo) para distinguirlo de "tu archivo no sirve".
 */
export function ErrorGenericCard({ status, canRetry, onRetry, onChooseFile }: Props) {
  const saved = status.highlightsNew > 0;
  const info = describeError(status.errorCode, { saved, source: status.source });
  const code = status.errorCode ?? "ERR_IMPORT_5001";
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    if (await copyText(code)) {
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2500);
    }
  }

  return (
    <>
      <div className="lec-imp-alert" role="alert" data-testid="error-generic">
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
            <circle cx="12" cy="12" r="9.2" />
            <path d="M12 7.6v5" />
            <path d="M12 16.2h.01" />
          </svg>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span className="lec-imp-alert-title">{info.title}</span>
            <p className="lec-imp-alert-body">
              {info.body} {info.savedNote}
            </p>
          </div>
        </div>

        <div className="lec-imp-codeline">
          <strong>{code}</strong>
          {status.finishedAt && <span>{formatDateTime(status.finishedAt)}</span>}
          <span>
            {status.fileName}
            {status.fileSize ? ` · ${formatBytes(status.fileSize)}` : ""}
          </span>
          <button type="button" className="lec-imp-link" onClick={copy}>
            Copiar código
          </button>
          <span className="sr-only" role="status" aria-live="polite" style={srOnly}>
            {copied ? "Código copiado" : ""}
          </span>
        </div>

        <div className="lec-imp-actions">
          {canRetry ? (
            <>
              <button type="button" className="lec-imp-btn lec-imp-btn-primary" onClick={onRetry}>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M20 11.5a8 8 0 1 1-2.6-5.9" />
                  <path d="M20 4.5v4.4h-4.4" />
                </svg>
                Reintentar
              </button>
              <button
                type="button"
                className="lec-imp-btn lec-imp-btn-secondary"
                onClick={onChooseFile}
              >
                Elegir otro archivo
              </button>
            </>
          ) : (
            <button type="button" className="lec-imp-btn lec-imp-btn-primary" onClick={onChooseFile}>
              Elegir otro archivo
            </button>
          )}
        </div>
      </div>
      <span className="lec-imp-mono-note">
        Si vuelve a pasar, mandanos el código: con eso vemos qué archivo lo causó sin necesidad de
        tus notas.
      </span>
    </>
  );
}

const srOnly: React.CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
};
