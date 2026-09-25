import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

const KEY = "corvuspt.theme";

export function applyTheme(dark: boolean) {
  document.documentElement.classList.toggle("dark", dark);
}

// Light/dark switch for the header. Light is the default; the choice is remembered in
// this browser (an inline script in <head> re-applies it before first paint).
export function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);
  function toggle() {
    const next = !dark;
    setDark(next);
    applyTheme(next);
    try {
      localStorage.setItem(KEY, next ? "dark" : "light");
    } catch {
      // storage blocked — the choice just lasts until reload
    }
  }
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Light mode" : "Dark mode"}
      className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground transition-all hover:rotate-12 hover:bg-secondary hover:text-foreground"
    >
      {dark ? <Sun className="h-4.5 w-4.5" /> : <Moon className="h-4.5 w-4.5" />}
    </button>
  );
}
