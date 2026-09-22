// Uso: npm run fixtures:covers → escribe las fixtures sintéticas en tests/fixtures/covers/
// Construye JPEG/PNG/WebP mínimos a mano (sin dependencias de imagen): alcanza para probar
// lib/covers/image-info.ts, que sólo lee cabeceras y marcadores, no decodifica píxeles.
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const out = (name: string) => resolve(__dirname, name);

// ─── PNG ──────────────────────────────────────────────────────────────────
function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

/**
 * `paddingBytes` simula el peso de una foto real: un color plano comprime casi a nada con
 * deflate, y el validador de portadas descarta como "reemplazo" cualquier archivo demasiado
 * liviano para sus dimensiones (bytes/píxel, lib/covers/placeholders.ts). Se agrega un chunk
 * privado y de sólo-copia ("miSC", convención de nombres de PNG) con relleno de ceros: cualquier
 * lector que no lo reconozca debe ignorarlo, igual que un decodificador real.
 */
function buildPng(width: number, height: number, paddingBytes = 0): Buffer {
  const rowBytes = 1 + width * 3;
  const raw = Buffer.alloc(rowBytes * height);
  for (let y = 0; y < height; y++) {
    const row = y * rowBytes;
    raw[row] = 0; // filtro "none"
    for (let x = 0; x < width; x++) {
      const px = row + 1 + x * 3;
      raw[px] = 180;
      raw[px + 1] = 140;
      raw[px + 2] = 90;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // profundidad de bits
  ihdr[9] = 2; // color type: RGB
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunks = [pngChunk("IHDR", ihdr), pngChunk("IDAT", deflateSync(raw))];
  if (paddingBytes > 0) chunks.push(pngChunk("miSC", Buffer.alloc(paddingBytes)));
  chunks.push(pngChunk("IEND", Buffer.alloc(0)));
  return Buffer.concat([signature, ...chunks]);
}

// ─── JPEG ─────────────────────────────────────────────────────────────────
function jpegSegment(marker: number, data: Buffer): Buffer {
  const len = Buffer.alloc(2);
  len.writeUInt16BE(data.length + 2, 0);
  return Buffer.concat([Buffer.from([0xff, marker]), len, data]);
}

/**
 * JPEG estructuralmente válido: SOI, APP0/JFIF, SOF0 con las dimensiones reales, SOS y datos de
 * "escaneo" (ceros, sin decodificar) terminados en EOI (FFD9). No es una foto real, pero es
 * suficiente para probar un parser que sólo lee marcadores de cabecera, como image-info.ts.
 */
function buildJpeg(width: number, height: number, opts: { endWithEoi?: boolean; fillerBytes?: number } = {}): Buffer {
  const { endWithEoi = true, fillerBytes = 32 } = opts;
  const soi = Buffer.from([0xff, 0xd8]);
  const app0 = jpegSegment(
    0xe0,
    Buffer.concat([Buffer.from("JFIF\0", "ascii"), Buffer.from([1, 1, 0, 0, 1, 0, 1, 0, 0])])
  );
  const nf = 3;
  const sofData = Buffer.alloc(6 + nf * 3);
  sofData[0] = 8; // precisión
  sofData.writeUInt16BE(height, 1);
  sofData.writeUInt16BE(width, 3);
  sofData[5] = nf;
  for (let c = 0; c < nf; c++) {
    sofData[6 + c * 3] = c + 1;
    sofData[6 + c * 3 + 1] = 0x11;
    sofData[6 + c * 3 + 2] = 0;
  }
  const sof0 = jpegSegment(0xc0, sofData);
  const sos = jpegSegment(0xda, Buffer.from([3, 1, 0, 2, 0, 3, 0, 0, 63, 0]));
  const filler = Buffer.alloc(fillerBytes, 0x00);
  const eoi = endWithEoi ? Buffer.from([0xff, 0xd9]) : Buffer.alloc(0);
  return Buffer.concat([soi, app0, sof0, sos, filler, eoi]);
}

// ─── WebP ─────────────────────────────────────────────────────────────────
/**
 * Contenedor RIFF/WEBP con un chunk VP8X (dimensiones extendidas). Cubre lo que necesita
 * image-info.ts (magic + tamaño RIFF consistente + dimensiones); no incluye un bitstream real
 * VP8/VP8L. Las fuentes reales investigadas (Open Library, Google Books) sólo devolvieron JPEG
 * y PNG (ver research.md de la feature 004): WebP es soporte defensivo, no un caso observado.
 */
function riffChunk(fourCc: string, data: Buffer): Buffer {
  const size = Buffer.alloc(4);
  size.writeUInt32LE(data.length, 0);
  const padding = data.length % 2 === 1 ? Buffer.from([0]) : Buffer.alloc(0);
  return Buffer.concat([Buffer.from(fourCc, "ascii"), size, data, padding]);
}

/** `paddingBytes`: mismo motivo que en `buildPng`. "JUNK" es la convención RIFF estándar de relleno. */
function buildWebp(width: number, height: number, paddingBytes = 0): Buffer {
  const vp8xData = Buffer.alloc(10);
  vp8xData[0] = 0; // flags
  vp8xData.writeUIntLE(width - 1, 4, 3);
  vp8xData.writeUIntLE(height - 1, 7, 3);
  const chunks = [riffChunk("VP8X", vp8xData)];
  if (paddingBytes > 0) chunks.push(riffChunk("JUNK", Buffer.alloc(paddingBytes)));
  const body = Buffer.concat(chunks);
  const riffSize = Buffer.alloc(4);
  riffSize.writeUInt32LE(4 + body.length, 0); // "WEBP" + chunks
  return Buffer.concat([Buffer.from("RIFF", "ascii"), riffSize, Buffer.from("WEBP", "ascii"), body]);
}

// ─── Escritura ────────────────────────────────────────────────────────────
// "valid.*" llevan relleno para no caer en el chequeo de reemplazo (bytes/píxel, R4): una imagen
// de 400×600 necesita ≥ 7.200 B para superar el umbral de 0,03 B/px; se deja margen holgado.
const valid = buildJpeg(400, 600, { fillerBytes: 20_000 });
writeFileSync(out("valid.jpg"), valid);
writeFileSync(out("valid.png"), buildPng(400, 600, 6_000));
writeFileSync(out("valid.webp"), buildWebp(400, 600, 10_000));
writeFileSync(out("truncated.jpg"), valid.subarray(0, valid.length - 30)); // sin el EOI final
writeFileSync(out("tiny.jpg"), buildJpeg(40, 60)); // bajo el mínimo de 100 px
writeFileSync(out("not-image.bin"), Buffer.from("<!DOCTYPE html><html><body>404 Not Found</body></html>"));
writeFileSync(out("huge.jpg"), buildJpeg(400, 600, { fillerBytes: 10 * 1024 * 1024 + 1024 })); // > 10 MB, completo

console.log("Fixtures de portadas escritas en tests/fixtures/covers/");
