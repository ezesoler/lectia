import {
  ADDED_WORDS,
  BOOKMARK_WORDS,
  HIGHLIGHT_WORDS,
  LOCATION_WORDS,
  MONTHS,
  NOTE_WORDS,
  PAGE_WORDS,
} from "./kindle-locales";
import { buildKeys, canonicalizeKindleAuthor, foldLatin } from "./normalize";
import type {
  DiscardBreakdown,
  DiscardReason,
  NoteKind,
  ParsedEntry,
  ParseResult,
} from "./types";

export const UNKNOWN_AUTHOR = "Autor desconocido";
const SEPARATOR = /^={10}\s*$/;

type EntryType = NoteKind | "bookmark" | "unknown";

const fold = (s: string): string => foldLatin(s).toLowerCase();

function classify(segment: string): EntryType {
  const folded = fold(segment);
  if (HIGHLIGHT_WORDS.some((w) => folded.includes(w))) return "highlight";
  if (BOOKMARK_WORDS.some((w) => folded.includes(w))) return "bookmark";
  if (NOTE_WORDS.some((w) => folded.includes(w))) return "note";
  return "unknown";
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const PAGE_RE = new RegExp(`(?:${PAGE_WORDS.map(escapeRe).join("|")})\\s*(\\d{1,7})`, "i");
const LOCATION_RE = new RegExp(
  `(?:${LOCATION_WORDS.map(escapeRe).join("|")})\\s*(\\d+(?:\\s*-\\s*\\d+)?)`,
  "i"
);

function parsePage(segment: string): number | undefined {
  const m = PAGE_RE.exec(fold(segment));
  return m?.[1] ? Number(m[1]) : undefined;
}

function parseLocation(segments: string[]): string {
  for (const segment of segments) {
    const m = LOCATION_RE.exec(fold(segment));
    if (m?.[1]) return m[1].replace(/\s+/g, "");
  }
  return "";
}

/** Mejor esfuerzo: si la fecha no se entiende devuelve undefined y la entrada se guarda igual. */
export function parseKindleDate(raw: string): string | undefined {
  const folded = fold(raw);
  const time = /(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?/.exec(folded);
  const withoutTime = time ? folded.replace(time[0], " ") : folded;
  const year = /\b(19\d{2}|20\d{2})\b/.exec(withoutTime);
  if (!year?.[1]) return undefined;

  let month: number | undefined;
  for (const token of withoutTime.split(/[^a-z\u00c0-\u024f]+/)) {
    const m = Object.hasOwn(MONTHS, token) ? MONTHS[token] : undefined;
    if (m) {
      month = m;
      break;
    }
  }
  if (!month) return undefined;

  const rest = withoutTime.replace(year[1], " ");
  const dayMatch = /\b(\d{1,2})\b/.exec(rest);
  const day = dayMatch?.[1] ? Number(dayMatch[1]) : undefined;
  if (!day || day < 1 || day > 31) return undefined;

  let hours = time?.[1] ? Number(time[1]) : 0;
  const minutes = time?.[2] ? Number(time[2]) : 0;
  const seconds = time?.[3] ? Number(time[3]) : 0;
  if (time?.[4] === "pm" && hours < 12) hours += 12;
  if (time?.[4] === "am" && hours === 12) hours = 0;

  const date = new Date(Date.UTC(Number(year[1]), month - 1, day, hours, minutes, seconds));
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function parseDate(segments: string[]): string | undefined {
  for (const segment of segments) {
    const folded = fold(segment);
    const word = ADDED_WORDS.find((w) => folded.includes(w));
    if (word) return parseKindleDate(segment.slice(folded.indexOf(word) + word.length));
  }
  const last = segments[segments.length - 1];
  return last ? parseKindleDate(last) : undefined;
}

/** "Título (Autor)": el último grupo entre paréntesis es el autor. */
function splitTitleAuthor(line: string): { title: string; author: string } {
  const m = /^(.*)\(([^()]*)\)\s*$/.exec(line);
  if (!m) return { title: line.trim(), author: UNKNOWN_AUTHOR };
  const title = (m[1] ?? "").trim();
  const rawAuthor = (m[2] ?? "").trim();
  return { title, author: rawAuthor ? canonicalizeKindleAuthor(rawAuthor) : UNKNOWN_AUTHOR };
}

/**
 * Parsea `My Clippings.txt` (UTF-8, con o sin BOM). Nunca lanza por contenido malformado:
 * cada registro descartado se cuenta con su motivo (FR-008). Un archivo sin ningún separador
 * `==========` devuelve `entries = []` y `discarded = 0` ("no es un clippings").
 */
export function parseClippings(text: string): ParseResult {
  const lines = text.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/);
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  const firstLine = lines.map((l) => l.replace(/\uFEFF/g, "").trim()).find((l) => l.length > 0);

  const chunks: string[][] = [];
  let current: string[] = [];
  let separators = 0;
  for (const line of lines) {
    if (SEPARATOR.test(line)) {
      separators += 1;
      chunks.push(current);
      current = [];
    } else {
      current.push(line);
    }
  }
  if (current.some((l) => l.trim() !== "")) chunks.push(current); // último registro sin cierre

  const base = { linesRead: lines.length, ...(firstLine ? { firstLine } : {}) };
  if (separators === 0) {
    return { entries: [], discarded: 0, discardBreakdown: {}, booksCount: 0, ...base };
  }

  const entries: ParsedEntry[] = [];
  const breakdown: DiscardBreakdown = {};
  let discarded = 0;
  const discard = (reason: DiscardReason) => {
    breakdown[reason] = (breakdown[reason] ?? 0) + 1;
    discarded += 1;
  };

  for (const chunk of chunks) {
    const clean = chunk.map((l) => l.replace(/\uFEFF/g, ""));
    let start = 0;
    while (start < clean.length && clean[start]!.trim() === "") start += 1;
    if (start >= clean.length) continue; // bloque vacío entre separadores

    const titleLine = clean[start]!.trim();
    const metaLine = clean[start + 1]?.trim();

    if (/^-\s/.test(titleLine) && titleLine.includes("|")) {
      discard("no_title");
      continue;
    }
    if (metaLine === undefined || !/^-\s/.test(metaLine)) {
      discard("truncated");
      continue;
    }

    const segments = metaLine.replace(/^-\s*/, "").split("|").map((s) => s.trim());
    const kind = classify(segments[0] ?? "");
    if (kind === "bookmark") {
      discard("bookmark_no_text");
      continue;
    }
    if (kind === "unknown") {
      discard("unknown_type");
      continue;
    }

    const body = clean.slice(start + 2).join("\n").trim();
    if (body === "") {
      discard("empty_text");
      continue;
    }

    const { title, author } = splitTitleAuthor(titleLine);
    if (title === "") {
      discard("no_title");
      continue;
    }

    const page = parsePage(segments[0] ?? "");
    const highlightedAt = parseDate(segments.slice(1));
    const chapterless: ParsedEntry = {
      title,
      author,
      kind,
      text: body,
      location: parseLocation(segments),
    };
    entries.push({
      ...chapterless,
      ...(page !== undefined ? { page } : {}),
      ...(highlightedAt ? { highlightedAt } : {}),
    });
  }

  const books = new Set<string>();
  for (const e of entries) {
    const { titleKey, authorKey } = buildKeys(e.title, e.author);
    books.add(`${titleKey}\u001f${authorKey}`);
  }

  return {
    entries,
    discarded,
    discardBreakdown: breakdown,
    booksCount: books.size,
    ...base,
  };
}
