import { createHash } from "node:crypto";
import { isKnownPlaceholder, isNearEmpty } from "./placeholders";
import type { CoverFormat, ImageInspection } from "./types";

/** Límites de FR-009: por encima de esto se descarta antes de guardar. */
export const MAX_COVER_BYTES = 10 * 1024 * 1024; // 10 MB
export const MIN_COVER_SIDE = 100; // px, lado menor

interface Dims {
  width: number;
  height: number;
  /** El archivo no terminó de descargarse o su estructura está incompleta. */
  truncated: boolean;
}

const u32be = (b: Uint8Array, i: number) => (b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!;
const u16be = (b: Uint8Array, i: number) => (b[i]! << 8) | b[i + 1]!;
const u32le = (b: Uint8Array, i: number) =>
  (b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16) | (b[i + 3]! << 24)) >>> 0;
const u24le = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16);

function isPng(b: Uint8Array): boolean {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return b.length >= 8 && sig.every((byte, i) => b[i] === byte);
}

function isJpeg(b: Uint8Array): boolean {
  return b.length >= 2 && b[0] === 0xff && b[1] === 0xd8;
}

function isWebp(b: Uint8Array): boolean {
  return (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && // "RIFF"
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 // "WEBP"
  );
}

/** SOFn (baseline/progresivo), excluyendo DHT/JPG/DAC que comparten el rango 0xC0–0xCF. */
function isSofMarker(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

/**
 * Recorre los segmentos de cabecera hasta SOS (donde empiezan los datos entropy-coded, que no
 * tienen estructura de segmentos) y toma las dimensiones del primer SOFn. La completitud del
 * archivo se decide por los dos últimos bytes: un JPEG completo termina en EOI (FFD9).
 */
function parseJpeg(b: Uint8Array): Dims | null {
  let i = 2;
  let dims: { width: number; height: number } | null = null;
  while (i + 1 < b.length) {
    if (b[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = b[i + 1]!;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2; // marcadores sin segmento de longitud
      continue;
    }
    if (marker === 0xda) break; // SOS: fin del recorrido de segmentos
    if (i + 3 >= b.length) break; // sin espacio para el campo de longitud: truncado
    const len = u16be(b, i + 2);
    if (isSofMarker(marker) && i + 4 + 4 < b.length) {
      dims = { width: u16be(b, i + 7), height: u16be(b, i + 5) };
    }
    i += 2 + len;
  }
  if (!dims) return null;
  const complete = b.length >= 2 && b[b.length - 2] === 0xff && b[b.length - 1] === 0xd9;
  return { ...dims, truncated: !complete };
}

/** IHDR trae las dimensiones; se exige IEND para considerar el archivo completo. */
function parsePng(b: Uint8Array): Dims | null {
  let i = 8;
  let dims: { width: number; height: number } | null = null;
  let sawIend = false;
  while (i + 8 <= b.length) {
    const len = u32be(b, i);
    const type = String.fromCharCode(b[i + 4]!, b[i + 5]!, b[i + 6]!, b[i + 7]!);
    const dataStart = i + 8;
    if (len < 0 || dataStart + len + 4 > b.length) break; // el chunk pide más de lo disponible
    if (type === "IHDR" && len >= 8) {
      dims = { width: u32be(b, dataStart), height: u32be(b, dataStart + 4) };
    }
    if (type === "IEND") {
      sawIend = true;
      break;
    }
    i = dataStart + len + 4;
  }
  return dims ? { ...dims, truncated: !sawIend } : null;
}

/**
 * Dimensiones desde VP8X (contenedor extendido), o si falta, desde el bitstream VP8L/VP8 (R3).
 * Las fuentes investigadas nunca devolvieron WebP (research.md E1–E6); este soporte es defensivo.
 */
function parseWebp(b: Uint8Array): Dims | null {
  const riffSize = u32le(b, 4);
  const sizeMismatch = riffSize + 8 !== b.length;
  let i = 12;
  let dims: { width: number; height: number } | null = null;
  let brokeEarly = false;
  while (i + 8 <= b.length) {
    const type = String.fromCharCode(b[i]!, b[i + 1]!, b[i + 2]!, b[i + 3]!);
    const size = u32le(b, i + 4);
    const dataStart = i + 8;
    if (dataStart + size > b.length) {
      brokeEarly = true;
      break;
    }
    if (type === "VP8X" && size >= 10) {
      dims = { width: u24le(b, dataStart + 4) + 1, height: u24le(b, dataStart + 7) + 1 };
    } else if (!dims && type === "VP8L" && size >= 5 && b[dataStart] === 0x2f) {
      const bits = u32le(b, dataStart + 1);
      dims = { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    } else if (
      !dims &&
      type === "VP8 " &&
      size >= 10 &&
      b[dataStart + 3] === 0x9d &&
      b[dataStart + 4] === 0x01 &&
      b[dataStart + 5] === 0x2a
    ) {
      dims = {
        width: (b[dataStart + 6]! | (b[dataStart + 7]! << 8)) & 0x3fff,
        height: (b[dataStart + 8]! | (b[dataStart + 9]! << 8)) & 0x3fff,
      };
    }
    i = dataStart + size + (size % 2); // los chunks RIFF se rellenan a longitud par
  }
  return dims ? { ...dims, truncated: sizeMismatch || brokeEarly } : null;
}

/**
 * Valida y describe una imagen descargada, en el orden de FR-009: formato reconocido → completa
 * (no truncada) → tamaño ≤ 10 MB → lado menor ≥ 100 px → no es un reemplazo conocido de "portada
 * no disponible". No decodifica píxeles: sólo lee cabeceras, así que nunca recomprime (FR-007).
 */
export function inspectImage(bytes: Uint8Array): ImageInspection {
  let format: CoverFormat;
  let dims: Dims | null;
  if (isPng(bytes)) {
    format = "png";
    dims = parsePng(bytes);
  } else if (isJpeg(bytes)) {
    format = "jpeg";
    dims = parseJpeg(bytes);
  } else if (isWebp(bytes)) {
    format = "webp";
    dims = parseWebp(bytes);
  } else {
    return { valid: false, reason: "not_image" };
  }

  if (!dims || dims.truncated) return { valid: false, reason: "truncated" };
  if (bytes.length > MAX_COVER_BYTES) return { valid: false, reason: "too_large" };
  if (Math.min(dims.width, dims.height) < MIN_COVER_SIDE) return { valid: false, reason: "too_small" };

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (isKnownPlaceholder(sha256) || isNearEmpty(bytes.length, dims.width, dims.height)) {
    return { valid: false, reason: "placeholder" };
  }

  return { valid: true, format, width: dims.width, height: dims.height, bytes: bytes.length, sha256 };
}
