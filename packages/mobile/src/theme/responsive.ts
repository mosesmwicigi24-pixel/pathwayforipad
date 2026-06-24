// Responsive type scaling. The design is drawn at ~390pt (a modern phone); this
// flexes every font size to the device's shortest side so text feels right on
// small phones and large phones/foldables, clamped so it never gets tiny or
// oversized. The OS accessibility font setting still multiplies on top of this.
//
// Kept separate from tokens.ts (which stays framework-free for unit tests) — this
// module touches react-native and is only pulled in by the rendering layer.
import { Dimensions } from "react-native";

function deviceShortestSide(): number {
  try {
    const { width, height } = Dimensions.get("window");
    const s = Math.min(width || 0, height || 0);
    return s > 0 ? s : 390;
  } catch {
    return 390;
  }
}

/** Global font scale for this device (0.90–1.15 of the 390pt baseline). */
export const FONT_SCALE = Math.min(Math.max(deviceShortestSide() / 390, 0.9), 1.15);

// User preference multiplier (Small / Default / Large) on top of the device scale.
// Kept here so rf() — used by non-T callers like buttons — stays in sync with the
// FontScale context. The context drives the re-render when it changes.
let userMult = 1;
export function setUserFontMult(m: number): void {
  userMult = m;
}
export function getUserFontMult(): number {
  return userMult;
}

/** Scale a font size designed at ~390pt to this device + the user preference. */
export function rf(n: number): number {
  return Math.round(n * FONT_SCALE * userMult);
}
