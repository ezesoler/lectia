"use client";

import { useEffect, useState } from "react";

type SimpleTheme = "light" | "dark";

function getInitialTheme(): SimpleTheme {
  if (typeof window === "undefined") return "light";
  const stored = localStorage.getItem("theme");
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function ThemeSwitch() {
  const [theme, setTheme] = useState<SimpleTheme>("light");

  useEffect(() => {
    setTheme(getInitialTheme());
  }, []);

  function toggle() {
    const next: SimpleTheme = theme === "light" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("theme", next);
    setTheme(next);

    fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme: next }),
    }).catch(() => {});
  }

  const isDark = theme === "dark";
  // Perilla: travel = 46 - 2*2.5 - 22 = 19px
  // Modo claro → perilla a la derecha (sol); modo oscuro → perilla a la izquierda (luna)
  const knobX = isDark ? "0px" : "19px";

  // Colores según mockup
  const moonColor   = isDark ? "var(--ink)"    : "var(--line-3)";
  const sunColor    = isDark ? "var(--line-3)" : "var(--accent)";
  const trackBg     = isDark ? "var(--raised)" : "var(--accent)";
  const trackShadow = isDark ? "inset 0 0 0 1px var(--line-3)" : "none";
  const knobBg      = isDark ? "var(--ink-2)"  : "var(--on-ink)";

  return (
    <button
      onClick={toggle}
      aria-label={isDark ? "Cambiar a tema claro" : "Cambiar a tema oscuro"}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "9px",
        background: "none",
        border: "none",
        cursor: "pointer",
        padding: "2px",
      }}
    >
      {/* Luna — izquierda, filled */}
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden
        style={{
          display: "block",
          color: moonColor,
          flexShrink: 0,
          transition: "color .28s ease",
        }}
      >
        <path
          d="M20.5 14.3A8.5 8.5 0 0 1 9.7 3.5a8.5 8.5 0 1 0 10.8 10.8Z"
          fill="currentColor"
        />
      </svg>

      {/* Pista */}
      <span
        role="presentation"
        style={{
          display: "block",
          width: "46px",
          height: "27px",
          padding: "2.5px",
          borderRadius: "999px",
          background: trackBg,
          boxShadow: trackShadow,
          flexShrink: 0,
          position: "relative",
          transition: "background .28s cubic-bezier(.4,.2,.2,1), box-shadow .28s ease",
        }}
      >
        {/* Perilla */}
        <span
          style={{
            display: "block",
            width: "22px",
            height: "22px",
            borderRadius: "50%",
            background: knobBg,
            boxShadow: "0 1px 3px var(--emboss-2), 0 1px 1px var(--emboss)",
            transform: `translateX(${knobX})`,
            transition: "transform .28s cubic-bezier(.4,.2,.2,1), background .28s ease",
          }}
        />
      </span>

      {/* Sol — derecha, círculo filled + rays stroke */}
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        aria-hidden
        style={{
          display: "block",
          color: sunColor,
          flexShrink: 0,
          transition: "color .28s ease",
        }}
      >
        <circle cx="12" cy="12" r="4.6" fill="currentColor" stroke="none" />
        <line x1="12" y1="2" x2="12" y2="4" />
        <line x1="12" y1="20" x2="12" y2="22" />
        <line x1="4.2" y1="4.2" x2="5.6" y2="5.6" />
        <line x1="18.4" y1="18.4" x2="19.8" y2="19.8" />
        <line x1="2" y1="12" x2="4" y2="12" />
        <line x1="20" y1="12" x2="22" y2="12" />
        <line x1="4.2" y1="19.8" x2="5.6" y2="18.4" />
        <line x1="18.4" y1="5.6" x2="19.8" y2="4.2" />
      </svg>
    </button>
  );
}
