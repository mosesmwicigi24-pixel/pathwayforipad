// Shared keyboard-inset hook. Returns the live on-screen keyboard height so a
// sticky composer / bottom sheet / scroll view can float its inputs above the
// keyboard instead of being covered. Centralizes the pattern that previously
// lived inline in ChatThreadScreen + ProfileScreen's SheetShell.
import { useEffect, useState } from "react";
import { Keyboard, Platform } from "react-native";

export function useKeyboardInset(): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const showEvt = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvt = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const onShow = Keyboard.addListener(showEvt, (e) => setHeight(e.endCoordinates?.height ?? 0));
    const onHide = Keyboard.addListener(hideEvt, () => setHeight(0));
    return () => {
      onShow.remove();
      onHide.remove();
    };
  }, []);
  return height;
}
