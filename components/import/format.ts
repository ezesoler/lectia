const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** 1.284 (separador de miles es-AR). */
export function formatInt(n: number): string {
  return new Intl.NumberFormat("es-AR").format(n);
}

/** 86 KB · 18,4 MB (coma decimal, como en los mockups). */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1).replace(".", ",")} MB`;
}

/** 21 sep 2026, 09:41 (hora local del navegador). */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const SOURCE_LABEL = { kindle: "Kindle", kobo: "Kobo" } as const;
export const SOURCE_FILE = { kindle: "My Clippings.txt", kobo: "KoboReader.sqlite" } as const;
export const SOURCE_EXTENSION = { kindle: ".txt", kobo: ".sqlite" } as const;
