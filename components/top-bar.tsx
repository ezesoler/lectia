"use client";

import { useState, useRef, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { ThemeSwitch } from "./theme-switch";

interface TopBarProps {
  displayName: string | null;
}

export function TopBar({ displayName }: TopBarProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Cerrar menú al hacer clic fuera
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  async function handleSignOut() {
    setLoading(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const initial = displayName?.charAt(0).toUpperCase() ?? "?";

  return (
    <header
      style={{
        height: "56px",
        backgroundColor: "var(--bar)",
        borderBottom: "1px solid var(--line)",
        backdropFilter: "blur(8px)",
        position: "sticky",
        top: 0,
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 clamp(16px, 3vw, 32px)",
      }}
    >
      {/* Logotipo */}
      <span
        style={{
          fontFamily: "var(--font-serif)",
          fontSize: "27px",
          fontWeight: 600,
          letterSpacing: "-0.01em",
          color: "var(--ink)",
        }}
      >
        Lectia.
      </span>

      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <ThemeSwitch />

        {/* Avatar + menú */}
        <div ref={menuRef} style={{ position: "relative" }}>
          <button
            onClick={() => setOpen((o) => !o)}
            aria-label={`Menú de ${displayName ?? "usuario"}`}
            aria-expanded={open}
            style={{
              width: "36px",
              height: "36px",
              borderRadius: "50%",
              backgroundColor: "var(--raised)",
              border: "1px solid var(--line)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              fontFamily: "var(--font-serif)",
              fontSize: "16px",
              fontWeight: 500,
              color: "var(--ink)",
            }}
          >
            {initial}
          </button>

          {open && (
            <div
              role="menu"
              style={{
                position: "absolute",
                top: "calc(100% + 8px)",
                right: 0,
                minWidth: "160px",
                backgroundColor: "var(--card)",
                border: "1px solid var(--line-3)",
                borderRadius: "4px",
                boxShadow: "0 12px 30px -12px var(--drop)",
                overflow: "hidden",
              }}
            >
              {displayName && (
                <div
                  style={{
                    padding: "10px 14px",
                    borderBottom: "1px solid var(--line-2)",
                    fontSize: "13px",
                    color: "var(--ink-2)",
                    fontFamily: "var(--font-sans)",
                  }}
                >
                  {displayName}
                </div>
              )}
              <button
                role="menuitem"
                onClick={handleSignOut}
                disabled={loading}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "10px 14px",
                  background: "none",
                  border: "none",
                  cursor: loading ? "not-allowed" : "pointer",
                  fontSize: "14px",
                  color: "var(--ink)",
                  fontFamily: "var(--font-sans)",
                }}
              >
                {loading ? "Cerrando sesión…" : "Cerrar sesión"}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
