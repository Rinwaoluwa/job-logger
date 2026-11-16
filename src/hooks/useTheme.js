import { useCallback, useEffect, useState } from "react";

// Light, dark, or follow the system. The choice is on <html data-theme>
// (styles/tokens.css reads it); index.html applies the stored value before
// first paint so a dark session never flashes light.
const KEY = "ui.theme";
const ORDER = ["system", "dark", "light"];

function read() {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

function apply(theme) {
  const el = document.documentElement;
  if (theme === "system") delete el.dataset.theme;
  else el.dataset.theme = theme;
}

export function useTheme() {
  const [theme, setThemeState] = useState(read);

  useEffect(() => { apply(theme); }, [theme]);

  const setTheme = useCallback((next) => {
    setThemeState(next);
    try {
      if (next === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, next);
    } catch {
      /* private window etc — non-fatal */
    }
  }, []);

  const cycle = useCallback(() => {
    setTheme(ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length]);
  }, [theme, setTheme]);

  return { theme, setTheme, cycle };
}
