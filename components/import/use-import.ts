"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { MAX_FILE_SIZE, type ImportSource, type ImportStatus } from "@/lib/import/types";
import { SOURCE_EXTENSION, SOURCE_FILE, SOURCE_LABEL } from "./format";

export type ImportPhase = "idle" | "uploading" | "parsing" | "done" | "error";

export const POLL_MS = 1000;
export const POLL_BACKOFF_MS = 3000;

export interface ImportController {
  source: ImportSource;
  phase: ImportPhase;
  status: ImportStatus | null;
  /** Mensaje inline (validación, conexión, importación en curso); no es un estado de la importación. */
  message: string | null;
  /** Archivo que se está subiendo (para mostrar nombre y tamaño antes de que exista el import). */
  pendingFile: { name: string; size: number } | null;
  /** FR-030: sólo hay reintento mientras la pestaña conserve el archivo en memoria. */
  canRetry: boolean;
  start: (file: File) => Promise<void>;
  retry: () => Promise<void>;
  dismissMessage: () => void;
}

const isActive = (s: ImportStatus | null): s is ImportStatus =>
  s !== null && (s.state === "queued" || s.state === "parsing");

function optimisticStatus(source: ImportSource, importId: string, file: File): ImportStatus {
  return {
    id: importId,
    source,
    state: "parsing",
    fileName: file.name,
    fileSize: file.size,
    entriesTotal: 0,
    entriesDone: 0,
    booksCount: 0,
    highlightsNew: 0,
    highlightsDup: 0,
    discarded: 0,
    discardBreakdown: {},
    errorCode: null,
    errorMessage: null,
    errorDetails: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };
}

async function fetchStatus(importId: string): Promise<ImportStatus | "gone" | null> {
  try {
    const res = await fetch(`/api/imports/${importId}`, { cache: "no-store" });
    if (res.status === 404) return "gone";
    if (!res.ok) return null;
    return (await res.json()) as ImportStatus;
  } catch {
    return null;
  }
}

/** Validación de cliente: feedback inmediato, no autoritativa (el servidor revalida). */
export function validateFile(source: ImportSource, file: File): string | null {
  if (!file.name.toLowerCase().endsWith(SOURCE_EXTENSION[source])) {
    return `Ese archivo no es el de ${SOURCE_LABEL[source]}. Buscá ${SOURCE_FILE[source]}.`;
  }
  if (file.size === 0) return "El archivo está vacío.";
  if (file.size > MAX_FILE_SIZE) return "El archivo supera el máximo de 50 MB.";
  return null;
}

export function useImport(source: ImportSource, initial: ImportStatus | null): ImportController {
  const [status, setStatus] = useState<ImportStatus | null>(initial);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const fileRef = useRef<File | null>(null);
  const [canRetry, setCanRetry] = useState(false);
  const [pendingFile, setPendingFile] = useState<{ name: string; size: number } | null>(null);

  const activeId = isActive(status) ? status.id : null;

  // Sondeo mientras haya un import activo (incluye el estado inicial traído por el servidor)
  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      const next = await fetchStatus(activeId);
      if (cancelled) return;
      if (next === "gone") {
        setStatus(null);
        return;
      }
      if (next === null) {
        timer = setTimeout(tick, POLL_BACKOFF_MS); // error de red: reintenta más despacio
        return;
      }
      setStatus(next);
      if (isActive(next)) timer = setTimeout(tick, POLL_MS);
    };

    timer = setTimeout(tick, POLL_MS);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [activeId]);

  const start = useCallback(
    async (file: File) => {
      setMessage(null);
      const invalid = validateFile(source, file);
      if (invalid) {
        setMessage(invalid);
        return;
      }
      fileRef.current = file;
      setCanRetry(true);
      setPendingFile({ name: file.name, size: file.size });
      setUploading(true);
      try {
        const created = await fetch("/api/imports", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ source, fileName: file.name, fileSize: file.size }),
        });
        // Con la sesión vencida el middleware redirige a /login en lugar de responder 401
        if (created.redirected && new URL(created.url).pathname.startsWith("/login")) {
          setMessage("Tu sesión venció. Volvé a iniciar sesión para importar.");
          return;
        }
        const body = (await created.json().catch(() => null)) as {
          importId?: string;
          upload?: { bucket: string; path: string; token: string };
          error?: { code: string; message: string; details?: { importId?: string } };
        } | null;

        if (created.status === 409) {
          // FR-025: hay una importación en curso; se rechaza y se muestra la activa sin interrumpirla
          setMessage(
            `Ya hay una importación en curso para ${SOURCE_LABEL[source]}. Esperá a que termine.`
          );
          const activeImport = body?.error?.details?.importId;
          if (activeImport) {
            const active = await fetchStatus(activeImport);
            if (active && active !== "gone") setStatus(active);
          }
          return;
        }
        if (!created.ok || !body?.importId || !body.upload) {
          setMessage(body?.error?.message ?? "No pudimos iniciar la importación. Probá de nuevo.");
          return;
        }

        const { importId, upload } = body;
        const { error: uploadError } = await createClient()
          .storage.from(upload.bucket)
          .uploadToSignedUrl(upload.path, upload.token, file);
        if (uploadError) {
          // Libera el cupo sin esperar el vencimiento (contracts/imports-api.md, DELETE)
          await fetch(`/api/imports/${importId}`, { method: "DELETE" }).catch(() => undefined);
          setMessage("No pudimos subir el archivo. Revisá la conexión y probá de nuevo.");
          return;
        }

        const parse = await fetch(`/api/imports/${importId}/parse`, { method: "POST" });
        if (parse.status !== 202) {
          const parseBody = (await parse.json().catch(() => null)) as {
            error?: { message: string };
          } | null;
          setMessage(parseBody?.error?.message ?? "No pudimos iniciar el procesamiento.");
          return;
        }

        const fresh = await fetchStatus(importId);
        setStatus(fresh && fresh !== "gone" ? fresh : optimisticStatus(source, importId, file));
      } catch {
        setMessage("Se cortó la conexión. Revisá tu internet y probá de nuevo.");
      } finally {
        setUploading(false);
      }
    },
    [source]
  );

  const retry = useCallback(async () => {
    const file = fileRef.current;
    if (file) await start(file);
  }, [start]);

  const dismissMessage = useCallback(() => setMessage(null), []);

  let phase: ImportPhase = "idle";
  if (uploading) phase = "uploading";
  else if (status?.state === "done") phase = "done";
  else if (status?.state === "error") phase = "error";
  else if (isActive(status)) phase = "parsing";

  return { source, phase, status, message, pendingFile, canRetry, start, retry, dismissMessage };
}
