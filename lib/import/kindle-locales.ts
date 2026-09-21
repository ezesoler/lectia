// Diccionarios por idioma para leer la línea de metadatos de My Clippings.txt.
// Idiomas cubiertos: es, en, pt, fr, de, it y japonés. Las palabras se comparan ya
// "plegadas" (minúsculas y sin diacríticos latinos, ver foldLatin).

/** Se detecta por la palabra clave, nunca por el artículo: el archivo real dice "La subrayado". */
export const HIGHLIGHT_WORDS = [
  "subrayado",
  "highlight",
  "destaque",
  "surlignement",
  "markierung",
  "evidenziazione",
  "sottolineatura",
  "ハイライト",
  "تمييز", // árabe (mejor esfuerzo)
];

export const NOTE_WORDS = ["nota", "note", "notiz", "anotacao", "annotation", "メモ", "ملاحظة"];

/** Marcadores y recortes: no son resaltados con texto guardable. */
export const BOOKMARK_WORDS = [
  "marcador",
  "bookmark",
  "signet",
  "lesezeichen",
  "segnalibro",
  "favorito",
  "ブックマーク",
  "إشارة مرجعية",
  "recorte",
  "clip",
  "ausschnitt",
  "ritaglio",
  "decoupe",
  "coupure",
];

export const PAGE_WORDS = ["page", "pagina", "seite", "ページ"];
export const LOCATION_WORDS = [
  "location",
  "posicion",
  "posicao",
  "emplacement",
  "position",
  "posizione",
  "pos.",
  "位置no.",
  "位置",
];
export const ADDED_WORDS = [
  "added on",
  "anadido el",
  "adicionado em",
  "ajoute le",
  "hinzugefugt am",
  "aggiunto il",
  "追加日",
];

/** Nombres completos de mes (plegados) → número 1–12. Sin prefijos: "mar" chocaría con "martes". */
export const MONTHS: Record<string, number> = {
  // en
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8,
  september: 9, october: 10, november: 11, december: 12,
  // es
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8,
  septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
  // pt
  janeiro: 1, fevereiro: 2, marco: 3, maio: 5, junho: 6, julho: 7, setembro: 9,
  outubro: 10, novembro: 11, novembre: 11, dezembro: 12,
  // fr
  janvier: 1, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, aout: 8,
  septembre: 9, octobre: 10, decembre: 12,
  // de
  januar: 1, februar: 2, marz: 3, juni: 6, juli: 7, oktober: 10, dezember: 12,
  // it
  gennaio: 1, febbraio: 2, aprile: 4, maggio: 5, giugno: 6, luglio: 7, settembre: 9,
  ottobre: 10, dicembre: 12,
};
