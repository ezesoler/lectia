import { getJson } from "./http";
import type { ApiCandidate, BookQuery, HttpDeps } from "./types";

const ENDPOINT = "https://www.googleapis.com/books/v1/volumes";
const FIELDS =
  "items(volumeInfo(title,authors,categories,pageCount,imageLinks,industryIdentifiers))";

interface GoogleVolume {
  volumeInfo?: {
    title?: string;
    authors?: string[];
    categories?: string[];
    pageCount?: number;
    imageLinks?: { thumbnail?: string; smallThumbnail?: string };
    industryIdentifiers?: { type?: string; identifier?: string }[];
  };
}

/** Sólo título, autor e ISBN viajan a Google Books; la clave va en la URL y nunca al cliente. */
export function googleBooksUrl(query: Pick<BookQuery, "title" | "author" | "isbn">): string {
  const params = new URLSearchParams({ maxResults: "3", fields: FIELDS });
  params.set(
    "q",
    query.isbn ? `isbn:${query.isbn}` : `intitle:"${query.title}" inauthor:"${query.author}"`
  );
  const key = process.env["GOOGLE_BOOKS_API_KEY"];
  if (key) params.set("key", key);
  return `${ENDPOINT}?${params.toString()}`;
}

const toHttps = (url: string) => url.replace(/^http:\/\//i, "https://");

/** Candidatos de Google Books; `null` si la API falló tras los reintentos. */
export async function searchGoogleBooks(
  query: Pick<BookQuery, "title" | "author" | "isbn">,
  deps: HttpDeps = {}
): Promise<ApiCandidate[] | null> {
  // Sin clave la cuota anónima compartida devuelve 429 casi siempre y cada libro gastaría
  // 7 s de reintentos: sin GOOGLE_BOOKS_API_KEY no se consulta Google Books.
  if (!process.env["GOOGLE_BOOKS_API_KEY"]) return null;
  const data = await getJson<{ items?: GoogleVolume[] }>(googleBooksUrl(query), deps);
  if (!data) return null;

  return (data.items ?? []).flatMap((item): ApiCandidate[] => {
    const info = item.volumeInfo;
    if (!info?.title) return [];
    const cover = info.imageLinks?.thumbnail ?? info.imageLinks?.smallThumbnail;
    const category = info.categories?.find((c) => c.trim().length > 0);
    const isbn = info.industryIdentifiers?.find((i) => i.type?.startsWith("ISBN"))?.identifier;
    return [
      {
        title: info.title,
        authors: info.authors ?? [],
        viaIsbn: Boolean(query.isbn),
        coverSource: "google_books",
        ...(isbn ? { isbn } : {}),
        // Sólo procedencia: lib/covers/candidates.ts deriva de acá zoom=0/4/3/2 (research.md E3/E4)
        ...(cover ? { coverOrigin: toHttps(cover) } : {}),
        ...(category ? { category: category.trim() } : {}),
        ...(info.pageCount && info.pageCount > 0 ? { pages: info.pageCount } : {}),
      },
    ];
  });
}
