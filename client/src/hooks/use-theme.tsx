import { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from "react";
import {
  applyTheme,
  isDarkTheme,
  oppositeTheme,
  resolveTheme,
  saveTheme,
  storedTheme,
  type ThemeId,
} from "@/lib/themes";

/**
 * Theme state. `theme` is now any registered theme id (nine palettes, see lib/themes.ts); the previous
 * "light" / "dark" values still work as inputs (mapped to Lumière / Lumière Dark) and `toggleTheme`
 * keeps its meaning: flip between a light and a dark look.
 */
interface ThemeContextType {
  theme: ThemeId;
  isDark: boolean;
  toggleTheme: () => void;
  setTheme: (theme: ThemeId | "light" | "dark") => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>(() => storedTheme());

  // The inline bootstrap in index.html has already applied the saved theme before first paint;
  // this keeps the document in sync with later changes.
  useEffect(() => {
    applyTheme(theme);
    saveTheme(theme);
  }, [theme]);

  const setTheme = useCallback((next: ThemeId | "light" | "dark") => setThemeState(resolveTheme(next)), []);
  const toggleTheme = useCallback(() => setThemeState((prev) => oppositeTheme(prev)), []);

  const value = useMemo(
    () => ({ theme, isDark: isDarkTheme(theme), toggleTheme, setTheme }),
    [theme, toggleTheme, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return context;
}
