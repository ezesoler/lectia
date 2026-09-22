import { getJson } from "./http";
import type { ApiCandidate, BookQuery, HttpDeps } from "./types";

const ENDPOINT = "https://openlibrary.org/search.json";
const FIELDS = "key,title,author_name,cover_i,number_of_pages_median,subject,isbn";

// Open Library permite ~3 req/s a las aplicaciones identificadas (1 req/s a las anónimas)
const MIN_INTERVAL_MS = 350;
let nextSlot = 0;

/** Limitador global de proceso: espacia las llamadas a Open Library. */
export function openLibrarySchedule<T>(task: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const slot = Math.max(now, nextSlot);
  nextSlot = slot + MIN_INTERVAL_MS;
  const delay = slot - now;
  return delay <= 0 ? task() : new Promise((resolve) => setTimeout(resolve, delay)).then(task);
}

interface OpenLibraryDoc {
  title?: string;
  author_name?: string[];
  cover_i?: number;
  number_of_pages_median?: number;
  subject?: string[];
  isbn?: string[];
}

/** Sólo título, autor e ISBN viajan a Open Library; nunca texto de resaltados. */
export function openLibraryUrl(query: Pick<BookQuery, "title" | "author" | "isbn">): string {
  const params = new URLSearchParams({ fields: FIELDS, limit: "3" });
  if (query.isbn) {
    params.set("q", `isbn:${query.isbn}`);
  } else {
    params.set("title", query.title);
    params.set("author", query.author);
  }
  return `${ENDPOINT}?${params.toString()}`;
}

/** Candidatos de Open Library; `null` si la API falló tras los reintentos. */
export async function searchOpenLibrary(
  query: Pick<BookQuery, "title" | "author" | "isbn">,
  deps: HttpDeps = {}
): Promise<ApiCandidate[] | null> {
  const contact = process.env["OPEN_LIBRARY_CONTACT"];
  const data = await getJson<{ docs?: OpenLibraryDoc[] }>(openLibraryUrl(query), {
    schedule: openLibrarySchedule,
    headers: { "User-Agent": contact ? `Lectia/0.1 (${contact})` : "Lectia/0.1" },
    ...deps,
  });
  if (!data) return null;

  return (data.docs ?? []).flatMap((doc): ApiCandidate[] => {
    if (!doc.title) return [];
    const subject = doc.subject?.find((s) => s.trim().length > 0);
    const isbn = doc.isbn?.find((i) => i.trim().length > 0);
    return [
      {
        title: doc.title,
        authors: doc.author_name ?? [],
        viaIsbn: Boolean(query.isbn),
        coverSource: "open_library",
        ...(isbn ? { isbn } : {}),
        // Sólo procedencia: lib/covers/candidates.ts deriva de acá el original y el -L (research.md E1)
        ...(doc.cover_i ? { coverOrigin: `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg` } : {}),
        ...(subject ? { category: subject.trim() } : {}),
        ...(doc.number_of_pages_median && doc.number_of_pages_median > 0
          ? { pages: Math.round(doc.number_of_pages_median) }
          : {}),
      },
    ];
  });
}
