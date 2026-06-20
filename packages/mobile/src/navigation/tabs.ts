// The five primary destinations (new design, Contract Matrix M1) as pure data
// so the structure is unit-testable without rendering react-native.
import type { TabParamList } from "./types";

export type TabName = keyof TabParamList;

export const TAB_ORDER: readonly TabName[] = ["Home", "Pathway", "Events", "Chat", "Give", "Profile"];

export const TAB_LABELS: Record<TabName, string> = {
  Home: "Home",
  Pathway: "Pathway",
  Give: "Give",
  Events: "Events",
  Chat: "Chat",
  Profile: "Profile",
};
