"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function GoogleLoginButton() {
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    setLoading(true);
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  }

  return (
    <button
      onClick={handleLogin}
      disabled={loading}
      aria-busy={loading}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "12px",
        width: "100%",
        minHeight: "52px",
        padding: "15px 18px",
        border: "1px solid var(--ink)",
        borderRadius: "3px",
        background: loading ? "var(--ink-hover)" : "var(--ink)",
        color: "var(--on-ink)",
        fontFamily: "var(--font-sans)",
        fontSize: "15.5px",
        fontWeight: 500,
        cursor: loading ? "not-allowed" : "pointer",
        opacity: loading ? 0.75 : 1,
        transition: "background 0.16s ease",
      }}
    >
      {loading ? (
        <>
          <span
            style={{
              width: "18px",
              height: "18px",
              border: "2px solid var(--on-ink)",
              borderTopColor: "transparent",
              borderRadius: "50%",
              animation: "lecSpin 0.7s linear infinite",
              display: "inline-block",
              flexShrink: 0,
            }}
            aria-hidden
          />
          Conectando…
        </>
      ) : (
        <>
          {/* Ícono G circular — tal como en el mockup */}
          <span
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "20px",
              height: "20px",
              borderRadius: "50%",
              background: "var(--on-ink)",
              color: "var(--ink)",
              fontFamily: "var(--font-serif)",
              fontSize: "14px",
              fontWeight: 600,
              flexShrink: 0,
            }}
            aria-hidden
          >
            G
          </span>
          Continuar con Google
        </>
      )}
    </button>
  );
}
