// @vitest-environment node
import { describe, expect, it } from "vitest";
import { isStale, PARSING_TTL_MS, QUEUED_TTL_MS } from "@/lib/import/stale";

const NOW = Date.parse("2026-09-21T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe("isStale", () => {
  it("un import parsing con latido reciente no está muerto", () => {
    expect(
      isStale({ state: "parsing", updated_at: ago(60_000), started_at: ago(600_000) }, NOW)
    ).toBe(false);
  });

  it("un import parsing sin latido por más de 5 min está muerto", () => {
    expect(
      isStale(
        { state: "parsing", updated_at: ago(PARSING_TTL_MS + 1), started_at: ago(900_000) },
        NOW
      )
    ).toBe(true);
  });

  it("un import queued vence a los 2 min", () => {
    expect(
      isStale({ state: "queued", updated_at: ago(QUEUED_TTL_MS - 1000), started_at: ago(1) }, NOW)
    ).toBe(false);
    expect(
      isStale({ state: "queued", updated_at: ago(QUEUED_TTL_MS + 1000), started_at: ago(1) }, NOW)
    ).toBe(true);
  });

  it("usa started_at si no hay updated_at", () => {
    expect(
      isStale({ state: "parsing", updated_at: null, started_at: ago(PARSING_TTL_MS + 5000) }, NOW)
    ).toBe(true);
  });

  it("una fecha ilegible no marca el import como muerto", () => {
    expect(isStale({ state: "parsing", updated_at: "nada", started_at: "nada" }, NOW)).toBe(false);
  });
});
