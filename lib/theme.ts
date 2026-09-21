export const VALID_THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof VALID_THEMES)[number];

export function resolveTheme(value: string | null | undefined): Theme {
  if (VALID_THEMES.includes(value as Theme)) {
    return value as Theme;
  }
  return "system";
}

/** Script inline para inyectar en <head> — evita el destello de tema incorrecto */
export const THEME_SCRIPT = `(function(){
  var t = localStorage.getItem('theme');
  var valid = ['light','dark','system'];
  if (t && valid.includes(t) && t !== 'system') {
    document.documentElement.setAttribute('data-theme', t);
  }
})();`;
