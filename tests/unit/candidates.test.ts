// @vitest-environment node
import { describe, expect, it } from "vitest";
import { coverCandidates } from "@/lib/covers/candidates";

describe("coverCandidates — Open Library", () => {
  it("el original va antes que -L (research.md E1: Dune, id 6976407)", () => {
    const c = coverCandidates(
      "https://covers.openlibrary.org/b/id/6976407-L.jpg?default=false",
      "open_library"
    );
    expect(c).toEqual([
      "https://covers.openlibrary.org/b/id/6976407.jpg?default=false",
      "https://covers.openlibrary.org/b/id/6976407-L.jpg?default=false",
    ]);
  });

  it("reconoce el id sin sufijo de tamaño y con -S/-M", () => {
    expect(coverCandidates("https://covers.openlibrary.org/b/id/123.jpg", "open_library")[0]).toContain(
      "/b/id/123.jpg"
    );
    expect(coverCandidates("https://covers.openlibrary.org/b/id/123-M.jpg", "open_library")).toHaveLength(2);
  });

  it("siempre pide default=false (research.md E2: sin eso, un id inexistente da un GIF 1x1)", () => {
    for (const url of coverCandidates("https://covers.openlibrary.org/b/id/1-L.jpg", "open_library")) {
      expect(url).toContain("default=false");
    }
  });

  it("una URL sin id reconocible da lista vacía", () => {
    expect(coverCandidates("https://covers.openlibrary.org/nope", "open_library")).toEqual([]);
  });
});

describe("coverCandidates — Google Books", () => {
  it("orden 0,4,3,2 y sin edge=curl (research.md E3/E4: Superficiales, id Nm6REAAAQBAJ)", () => {
    const c = coverCandidates(
      "http://books.google.com/books/content?id=Nm6REAAAQBAJ&printsec=frontcover&img=1&zoom=1&edge=curl&source=gbs_api",
      "google_books"
    );
    expect(c).toEqual([
      "https://books.google.com/books/content?id=Nm6REAAAQBAJ&printsec=frontcover&img=1&zoom=0",
      "https://books.google.com/books/content?id=Nm6REAAAQBAJ&printsec=frontcover&img=1&zoom=4",
      "https://books.google.com/books/content?id=Nm6REAAAQBAJ&printsec=frontcover&img=1&zoom=3",
      "https://books.google.com/books/content?id=Nm6REAAAQBAJ&printsec=frontcover&img=1&zoom=2",
    ]);
  });

  it("todas las candidatas son https, aunque el origen sea http", () => {
    const c = coverCandidates("http://books.google.com/books/content?id=X&zoom=1", "google_books");
    expect(c.every((u) => u.startsWith("https://"))).toBe(true);
  });

  it("extrae el id de una URL de imageLinks.thumbnail (books?id=...)", () => {
    const c = coverCandidates(
      "http://books.google.com/books?id=Orz6EAAAQBAJ&printsec=frontcover&img=1&zoom=1&edge=curl",
      "google_books"
    );
    expect(c[0]).toContain("id=Orz6EAAAQBAJ");
  });

  it("una URL de un host desconocido da lista vacía", () => {
    expect(coverCandidates("https://example.com/cover.jpg", "google_books")).toEqual([]);
  });
});
