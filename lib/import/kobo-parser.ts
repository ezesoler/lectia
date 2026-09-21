import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import { KoboFileError } from "./errors";
import { UNKNOWN_AUTHOR } from "./kindle-parser";
import { buildKeys } from "./normalize";
import type { DiscardBreakdown, DiscardReason, NoteKind, ParsedEntry, ParseResult } from "./types";

let sqlPromise: Promise<SqlJsStatic> | null = null;

/** sql.js (SQLite→WASM) se inicializa una sola vez por proceso. */
function loadSql(): Promise<SqlJsStatic> {
  sqlPromise ??= initSqlJs();
  return sqlPromise;
}

interface KoboBook {
  title: string;
  author: string;
  isbn?: string;
}

type Row = Record<string, unknown>;

function rows(db: Database, sql: string): Row[] {
  const stmt = db.prepare(sql);
  try {
    const out: Row[] = [];
    while (stmt.step()) out.push(stmt.getAsObject() as Row);
    return out;
  } finally {
    stmt.free();
  }
}

const text = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));

/** Fechas de Kobo: ISO sin zona ("2026-03-05T16:13:34.709"); se interpretan como UTC. */
function toIso(raw: unknown): string | undefined {
  const s = text(raw).trim();
  if (!s) return undefined;
  const withZone = /(Z|[+-]\d{2}:?\d{2})$/.test(s) ? s : `${s}Z`;
  const d = new Date(withZone);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/**
 * Lee las anotaciones de `KoboReader.sqlite` (firmware ≥ 2018) desde memoria: no escribe a disco.
 * Esquema verificado con un archivo real (research.md R5): `content` (ContentType es TEXTO) y
 * `Bookmark` con Type ∈ {highlight, note, markup, dogear}. En `note`, `Text` es el fragmento
 * anclado y el texto de la nota está en `Annotation`.
 */
export async function parseKobo(bytes: Uint8Array): Promise<ParseResult> {
  const SQL = await loadSql();

  let db: Database;
  try {
    db = new SQL.Database(bytes);
  } catch {
    throw new KoboFileError("corrupt");
  }

  try {
    let tables: string[];
    try {
      tables = rows(db, "select name from sqlite_master where type = 'table'").map((r) =>
        text(r["name"]).toLowerCase()
      );
    } catch {
      throw new KoboFileError("corrupt");
    }
    if (!tables.includes("bookmark") || !tables.includes("content")) {
      throw new KoboFileError("unsupported_schema");
    }

    let bookmarks: Row[];
    const books = new Map<string, KoboBook>();
    const chapters = new Map<string, string>();
    try {
      for (const r of rows(
        db,
        "select ContentID, Title, Attribution, ISBN from content where CAST(ContentType AS TEXT) = '6'"
      )) {
        const isbn = text(r["ISBN"]).trim();
        books.set(text(r["ContentID"]), {
          title: text(r["Title"]).trim(),
          author: text(r["Attribution"]).trim() || UNKNOWN_AUTHOR,
          ...(isbn ? { isbn } : {}),
        });
      }
      for (const r of rows(
        db,
        "select ContentID, Title from content where CAST(ContentType AS TEXT) != '6'"
      )) {
        const title = text(r["Title"]).trim();
        if (title) chapters.set(text(r["ContentID"]), title);
      }
      bookmarks = rows(
        db,
        "select VolumeID, ContentID, Type, Text, Annotation, StartContainerPath, StartOffset, EndOffset, DateCreated from Bookmark order by VolumeID, DateCreated, BookmarkID"
      );
    } catch (err) {
      if (err instanceof KoboFileError) throw err;
      // Columnas que no existen = otro esquema; cualquier otro fallo de lectura = archivo dañado
      const msg = (err as Error).message.toLowerCase();
      throw new KoboFileError(msg.includes("no such") ? "unsupported_schema" : "corrupt");
    }

    if (bookmarks.length === 0) throw new KoboFileError("empty");

    const entries: ParsedEntry[] = [];
    const breakdown: DiscardBreakdown = {};
    let discarded = 0;
    const discard = (reason: DiscardReason) => {
      breakdown[reason] = (breakdown[reason] ?? 0) + 1;
      discarded += 1;
    };

    for (const r of bookmarks) {
      const book = books.get(text(r["VolumeID"]));
      if (!book || book.title === "") {
        discard("orphan_volume");
        continue;
      }

      const type = text(r["Type"]).toLowerCase();
      let kind: NoteKind;
      let body: string;
      if (type === "highlight") {
        kind = "highlight";
        body = text(r["Text"]).trim();
      } else if (type === "note") {
        kind = "note";
        body = text(r["Annotation"]).trim();
      } else if (type === "markup" || type === "dogear") {
        discard("bookmark_no_text");
        continue;
      } else {
        discard("unknown_type");
        continue;
      }
      if (body === "") {
        discard("empty_text");
        continue;
      }

      const path = text(r["StartContainerPath"]);
      const location = path ? `${path}:${text(r["StartOffset"])}-${text(r["EndOffset"])}` : "";
      const chapter = chapters.get(text(r["ContentID"]));
      const highlightedAt = toIso(r["DateCreated"]);
      entries.push({
        title: book.title,
        author: book.author,
        ...(book.isbn ? { isbn: book.isbn } : {}),
        kind,
        text: body,
        location,
        ...(chapter ? { chapter } : {}),
        ...(highlightedAt ? { highlightedAt } : {}),
      });
    }

    const uniqueBooks = new Set<string>();
    for (const e of entries) {
      const { titleKey, authorKey } = buildKeys(e.title, e.author);
      uniqueBooks.add(`${titleKey}\u001f${authorKey}`);
    }

    return { entries, discarded, discardBreakdown: breakdown, booksCount: uniqueBooks.size };
  } finally {
    db.close();
  }
}
