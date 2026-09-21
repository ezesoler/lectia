import initSqlJs from "sql.js";

// Genera KoboReader.sqlite SINTÉTICOS con el esquema real observado (ContentType como TEXTO,
// Hidden = 'false', ISBN nulo, `note` con Annotation, `markup` sin texto). No contienen lecturas
// de nadie. Ver tests/fixtures/README.md.

export const HABITOS_VOLUME = "file:///mnt/onboard/Clear, James/Habitos atomicos - James Clear.kepub.epub";
export const JOBS_VOLUME = "file:///mnt/onboard/Isaacson, Walter/Steve Jobs_ Lecciones de liderazgo - Walter Isaacson.kepub.epub";
const ORPHAN_VOLUME = "file:///mnt/onboard/desconocido.epub";
const CHAPTER_ID = "OEBPS/Text/Habitos_atomicos-10_split_000.xhtml";

const SCHEMA = `
  create table content (
    ContentID text, ContentType text, Title text, Attribution text, ISBN text
  );
  create table Bookmark (
    BookmarkID text, VolumeID text, ContentID text, StartContainerPath text,
    StartContainerChildIndex int, StartOffset int, EndContainerPath text,
    EndContainerChildIndex int, EndOffset int, Text text, Annotation text,
    DateCreated text, ChapterProgress real, Hidden text, Type text
  );
`;

type BookmarkRow = [
  volume: string,
  contentId: string,
  path: string,
  start: number,
  end: number,
  text: string | null,
  annotation: string | null,
  date: string,
  type: string,
];

export const VALID_BOOKMARKS: BookmarkRow[] = [
  [HABITOS_VOLUME, CHAPTER_ID, "span#kobo\\.2\\.1", 0, 13, "Los hábitos son el interés compuesto de la superación personal.", "", "2026-03-05T16:13:34.709", "highlight"],
  [HABITOS_VOLUME, CHAPTER_ID, "span#kobo\\.3\\.1", 0, 23, "Cada acción es un voto a favor del tipo de persona en que quieres convertirte.", "", "2026-03-05T16:14:27.700", "highlight"],
  [HABITOS_VOLUME, CHAPTER_ID, "span#kobo\\.5\\.1", 0, 29, "Fragmento anclado a la nota", "Interesante concepto como eje de una mirada nueva.", "2026-03-05T16:15:42.277", "note"],
  [JOBS_VOLUME, "OEBPS/Text/jobs-1.xhtml", "span#kobo\\.1\\.1", 4, 44, "La gente que está lo bastante loca como para creer que puede cambiar el mundo.", "", "2026-04-10T09:00:00.000", "highlight"],
  // descartables
  [JOBS_VOLUME, "OEBPS/Text/jobs-1.xhtml", "span#kobo\\.9\\.1", 0, 0, "", "", "2026-04-10T09:05:00.000", "markup"],
  [JOBS_VOLUME, "OEBPS/Text/jobs-1.xhtml", "span#kobo\\.9\\.2", 0, 0, "", "", "2026-04-10T09:06:00.000", "dogear"],
  [JOBS_VOLUME, "OEBPS/Text/jobs-1.xhtml", "span#kobo\\.9\\.3", 0, 5, "", "", "2026-04-10T09:07:00.000", "highlight"],
  [ORPHAN_VOLUME, "OEBPS/Text/x.xhtml", "span#kobo\\.1\\.1", 0, 9, "Texto de un libro que ya no está", "", "2026-04-10T09:08:00.000", "highlight"],
];

/** 4 entradas válidas (3 subrayados + 1 nota), 4 descartadas (2 bookmark_no_text, 1 empty_text, 1 orphan_volume), 2 libros. */
export async function buildKoboDb(bookmarks: BookmarkRow[] = VALID_BOOKMARKS): Promise<Uint8Array> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  try {
    db.run(SCHEMA);
    db.run("insert into content values (?, ?, ?, ?, ?)", [HABITOS_VOLUME, "6", "Hábitos atómicos", "James Clear", null]);
    db.run("insert into content values (?, ?, ?, ?, ?)", [JOBS_VOLUME, "6", "Steve Jobs: Lecciones de liderazgo", "Walter Isaacson", null]);
    db.run("insert into content values (?, ?, ?, ?, ?)", [CHAPTER_ID, "9", "Capítulo 10", null, null]);
    bookmarks.forEach((b, i) => {
      db.run("insert into Bookmark values (?, ?, ?, ?, 0, ?, ?, 0, ?, ?, ?, ?, 0.1, 'false', ?)", [
        `bm-${i}`, b[0], b[1], b[2], b[3], b[2], b[4], b[5], b[6], b[7], b[8],
      ]);
    });
    return db.export();
  } finally {
    db.close();
  }
}

/** Esquema correcto pero sin ninguna anotación. */
export const buildKoboEmpty = () => buildKoboDb([]);

/** SQLite válido pero de otro esquema (sin content/Bookmark). */
export async function buildKoboNoSchema(): Promise<Uint8Array> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  try {
    db.run("create table other (a int); insert into other values (1);");
    return db.export();
  } finally {
    db.close();
  }
}

/** Cabecera SQLite intacta pero contenido truncado: el archivo "quedó incompleto" al copiarlo. */
export async function buildKoboCorrupt(): Promise<Uint8Array> {
  const valid = await buildKoboDb();
  return valid.slice(0, Math.max(1024, Math.floor(valid.length / 3)));
}
