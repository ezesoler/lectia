import { ThemeSwitch } from "@/components/theme-switch";
import { GoogleLoginButton } from "@/components/google-login-button";

const styles = `
  .lec-login-root {
    min-height: 100svh;
    display: flex;
    flex-direction: column;
    background: var(--paper);
  }
  .lec-login-hero {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 30px;
    padding: 18px 24px 34px;
    background: var(--raised);
    background-image: repeating-linear-gradient(0deg, var(--stripe) 0 1px, transparent 1px 26px);
    border-bottom: 1px solid var(--line-3);
  }
  .lec-login-header { display: flex; align-items: baseline; gap: 9px; }
  .lec-logo {
    font-family: var(--font-serif);
    font-size: 28px;
    font-weight: 600;
    letter-spacing: -0.01em;
    color: var(--ink);
  }
  .lec-version {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--ink-2);
  }
  .lec-hero-content {
    display: flex;
    flex-direction: column;
    gap: 30px;
  }
  .lec-kicker-label {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--accent);
  }
  .lec-headline {
    margin: 0;
    font-family: var(--font-sans);
    font-size: 40px;
    line-height: 1.02;
    font-weight: 700;
    letter-spacing: -0.04em;
    color: var(--ink);
  }
  .lec-hero-desc {
    margin: 0;
    font-size: 15px;
    line-height: 1.6;
    color: var(--ink-2);
  }
  .lec-login-form {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    padding: 28px 24px 24px;
  }
  .lec-form-inner {
    display: flex;
    flex-direction: column;
    gap: 22px;
  }
  .lec-login-h1 {
    margin: 0;
    font-family: var(--font-sans);
    font-size: 25px;
    font-weight: 600;
    letter-spacing: -0.025em;
    color: var(--ink);
  }
  .lec-login-note { display: block; }

  @media (min-width: 800px) {
    .lec-login-root {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 400px), 1fr));
    }
    .lec-login-hero {
      flex-shrink: unset;
      gap: 44px;
      padding: clamp(28px, 5vw, 56px) clamp(22px, 5vw, 60px);
      border-bottom: none;
      border-right: 1px solid var(--line);
      background-image: repeating-linear-gradient(0deg, var(--stripe) 0 1px, transparent 1px 30px);
    }
    .lec-logo { font-size: 34px; }
    .lec-version { font-size: 10.5px; }
    .lec-hero-content { max-width: 520px; margin: auto 0; gap: 30px; }
    .lec-kicker-label { font-size: 10.5px; letter-spacing: 0.18em; }
    .lec-headline { font-size: clamp(36px, 5.6vw, 60px); line-height: 1.0; }
    .lec-hero-desc { font-size: 15.5px; line-height: 1.65; max-width: 380px; }
    .lec-login-form {
      flex: unset;
      min-height: unset;
      justify-content: center;
      align-items: center;
      padding: 48px 40px;
    }
    .lec-form-inner { width: 100%; max-width: 372px; gap: 30px; }
    .lec-login-h1 { font-size: clamp(25px, 4vw, 31px); }
    .lec-login-note { display: none; }
  }
`;

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <>
      <style>{styles}</style>

      <div className="lec-login-root">

        {/* ── Hero ── */}
        <div className="lec-login-hero">

          {/* Logo + versión + tema */}
          <div className="lec-login-header">
            <span className="lec-logo">Lectia.</span>
            <span className="lec-version">v0.1</span>
            <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center" }}>
              <ThemeSwitch />
            </span>
          </div>

          {/* Kicker + titular + descripción */}
          <div className="lec-hero-content">

            {/* Kicker */}
            <div style={{ display: "flex", alignItems: "center", gap: "11px" }}>
              <span style={{ width: "36px", height: "2px", background: "var(--accent)", flexShrink: 0 }} />
              <span className="lec-kicker-label">Kindle + Kobo</span>
            </div>

            {/* Titular */}
            <h2 className="lec-headline">
              Tus lecturas,
              <br />
              tus notas,
              <br />
              <span
                style={{
                  display: "inline",
                  padding: "0 0.08em",
                  background: "linear-gradient(transparent 62%, var(--selection) 62%)",
                  WebkitBoxDecorationBreak: "clone",
                  boxDecorationBreak: "clone",
                } as React.CSSProperties}
              >
                tuyas para siempre.
              </span>
            </h2>

            {/* Descripción */}
            <p className="lec-hero-desc">
              Lectia reúne los resaltados de tu Kindle y tu Kobo en un solo lugar,
              con búsqueda real y exportación a Markdown.
            </p>
          </div>
        </div>

        {/* ── Formulario ── */}
        <div className="lec-login-form">
          <div className="lec-form-inner">

            {/* Error de autenticación */}
            {error === "auth_failed" && (
              <div
                role="alert"
                style={{
                  padding: "12px 14px",
                  border: "1px solid var(--line)",
                  borderRadius: "3px",
                  background: "var(--card)",
                  color: "var(--ink-2)",
                  fontSize: "13.5px",
                  lineHeight: 1.5,
                }}
              >
                No se pudo completar el acceso. Intentá de nuevo.
              </div>
            )}

            {/* Encabezado */}
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <h1 className="lec-login-h1">Entrar a tu biblioteca</h1>
              <p
                style={{
                  margin: 0,
                  fontSize: "14.5px",
                  lineHeight: 1.6,
                  color: "var(--ink-2)",
                }}
              >
                Usamos tu cuenta de Google para guardar tus notas. Sin contraseñas
                nuevas.
              </p>
            </div>

            <GoogleLoginButton />

            {/* Nota (sólo mobile) */}
            <p
              className="lec-login-note"
              style={{
                margin: 0,
                fontFamily: "var(--font-mono)",
                fontSize: "11px",
                lineHeight: 1.6,
                letterSpacing: "0.02em",
                color: "var(--ink-2)",
              }}
            >
              Tus archivos se procesan en el servidor. Nada se sube sin que lo pedís.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
