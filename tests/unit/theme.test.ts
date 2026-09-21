import { describe, it, expect } from "vitest";
import { resolveTheme, VALID_THEMES } from "@/lib/theme";

describe("resolveTheme", () => {
  it("devuelve 'light' para el valor 'light'", () => {
    expect(resolveTheme("light")).toBe("light");
  });

  it("devuelve 'dark' para el valor 'dark'", () => {
    expect(resolveTheme("dark")).toBe("dark");
  });

  it("devuelve 'system' para el valor 'system'", () => {
    expect(resolveTheme("system")).toBe("system");
  });

  it("devuelve 'system' para valores inválidos", () => {
    expect(resolveTheme("invalid")).toBe("system");
    expect(resolveTheme("")).toBe("system");
    expect(resolveTheme(null)).toBe("system");
    expect(resolveTheme(undefined)).toBe("system");
  });

  it("VALID_THEMES contiene exactamente los tres temas permitidos", () => {
    expect(VALID_THEMES).toEqual(["system", "light", "dark"]);
  });
});
