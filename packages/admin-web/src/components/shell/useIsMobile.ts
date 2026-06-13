// Tracks whether the viewport is below the mobile breakpoint (matches the make).
import { useEffect, useState } from "react";

const BREAKPOINT = 768;

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() =>
    typeof window !== "undefined" ? window.innerWidth < BREAKPOINT : false,
  );
  useEffect(() => {
    const onResize = (): void => setIsMobile(window.innerWidth < BREAKPOINT);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return isMobile;
}
