// In-app font-size preference (Small / Default / Large), layered ON TOP of the
// automatic device scaling (theme/responsive.ts). Persisted in AsyncStorage and
// exposed via context so the whole tree re-renders the instant it changes; it
// also keeps the responsive module's multiplier in sync so rf() (used by
// non-T callers like buttons) matches.
import { createContext, useContext, useEffect, useState, type ReactElement, type ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { setUserFontMult } from "./responsive.js";

export type FontSize = "small" | "default" | "large";
const MULT: Record<FontSize, number> = { small: 0.9, default: 1, large: 1.15 };
const KEY = "prefs:fontSize";

interface FontScaleCtx {
  size: FontSize;
  mult: number;
  setSize: (s: FontSize) => void;
}
const Ctx = createContext<FontScaleCtx>({ size: "default", mult: 1, setSize: () => undefined });

export function FontScaleProvider({ children }: { children: ReactNode }): ReactElement {
  const [size, setSizeState] = useState<FontSize>("default");
  useEffect(() => {
    void AsyncStorage.getItem(KEY).then((v) => {
      if (v === "small" || v === "default" || v === "large") {
        setUserFontMult(MULT[v]);
        setSizeState(v);
      }
    });
  }, []);
  function setSize(s: FontSize): void {
    setUserFontMult(MULT[s]); // keep rf() in sync for non-T callers
    setSizeState(s); // re-render the tree (T subscribes via useFontScale)
    void AsyncStorage.setItem(KEY, s).catch(() => undefined);
  }
  return <Ctx.Provider value={{ size, mult: MULT[size], setSize }}>{children}</Ctx.Provider>;
}

export function useFontScale(): FontScaleCtx {
  return useContext(Ctx);
}
