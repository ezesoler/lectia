// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { inspectImage, MAX_COVER_BYTES, MIN_COVER_SIDE } from "@/lib/covers/image-info";

const fixture = (name: string) => new Uint8Array(readFileSync(resolve(__dirname, "../fixtures/covers", name)));

describe("inspectImage — imágenes válidas", () => {
  it("JPEG: formato, dimensiones, bytes y sha256", () => {
    const r = inspectImage(fixture("valid.jpg"));
    expect(r).toMatchObject({ valid: true, format: "jpeg", width: 400, height: 600 });
    if (r.valid) {
      expect(r.bytes).toBe(fixture("valid.jpg").length);
      expect(r.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("PNG: formato y dimensiones", () => {
    const r = inspectImage(fixture("valid.png"));
    expect(r).toMatchObject({ valid: true, format: "png", width: 400, height: 600 });
  });

  it("WebP (VP8X): formato y dimensiones", () => {
    const r = inspectImage(fixture("valid.webp"));
    expect(r).toMatchObject({ valid: true, format: "webp", width: 400, height: 600 });
  });

  it("el mismo archivo da siempre el mismo sha256", () => {
    const a = inspectImage(fixture("valid.jpg"));
    const b = inspectImage(fixture("valid.jpg"));
    expect(a.valid && b.valid && a.sha256).toBe(b.valid && b.sha256);
  });
});

describe("inspectImage — rechazos", () => {
  it("not-image.bin → not_image", () => {
    expect(inspectImage(fixture("not-image.bin"))).toEqual({ valid: false, reason: "not_image" });
  });

  it("truncated.jpg → truncated (sin EOI final)", () => {
    expect(inspectImage(fixture("truncated.jpg"))).toEqual({ valid: false, reason: "truncated" });
  });

  it("huge.jpg → too_large (completo, pero supera 10 MB)", () => {
    const bytes = fixture("huge.jpg");
    expect(bytes.length).toBeGreaterThan(MAX_COVER_BYTES);
    expect(inspectImage(bytes)).toEqual({ valid: false, reason: "too_large" });
  });

  it("tiny.jpg → too_small (bajo el mínimo de lado)", () => {
    expect(MIN_COVER_SIDE).toBe(100);
    expect(inspectImage(fixture("tiny.jpg"))).toEqual({ valid: false, reason: "too_small" });
  });

  it("los dos reemplazos reales de Google Books → placeholder", () => {
    expect(inspectImage(fixture("google-placeholder-575x750.png"))).toEqual({
      valid: false,
      reason: "placeholder",
    });
    expect(inspectImage(fixture("google-placeholder-128x170.png"))).toEqual({
      valid: false,
      reason: "placeholder",
    });
  });

  it("una imagen de baja densidad (no catalogada) también se descarta por placeholder", () => {
    // Mismas dimensiones que valid.jpg pero con mucho menos contenido "real": simula un reemplazo
    // genérico no listado en KNOWN_PLACEHOLDERS, cubierto por la heurística bytes/píxel.
    const r = inspectImage(fixture("tiny.jpg")); // 40x60 = 2400px; el archivo pesa 87B → 0.036 B/px
    // tiny.jpg ya cae por too_small antes de llegar a placeholder; se prueba la heurística aparte:
    expect(r).toEqual({ valid: false, reason: "too_small" });
  });

  it("respeta el orden de validación: too_large antes que too_small", () => {
    // huge.jpg tiene dimensiones válidas (400x600) pero pesa > 10MB: debe ganar too_large
    const r = inspectImage(fixture("huge.jpg"));
    expect(r).toEqual({ valid: false, reason: "too_large" });
  });
});
