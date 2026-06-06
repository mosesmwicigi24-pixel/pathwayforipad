// Typed route params for @react-navigation (spec §1.3; Figma "Nuru Pathway app
// design"). The root native-stack hosts Login, the bottom-tab area, and the
// pushed learning flow (Level → Lesson → Quiz → LevelComplete) plus Giving and
// the calendar Event detail. The bottom tabs are the five primary destinations.
import type { NavigatorScreenParams } from "@react-navigation/native";

export type TabParamList = {
  Home: undefined;
  Levels: undefined;
  Calendar: undefined;
  Portal: undefined;
  Chat: undefined;
};

export type RootStackParamList = {
  Login: undefined;
  Tabs: NavigatorScreenParams<TabParamList> | undefined;
  Level: { levelId: number };
  Module: { moduleId: string };
  Quiz: { moduleId: string };
  LevelComplete: undefined;
  Giving: undefined;
  EventDetail: { eventId: string; title: string; startAt: string; endAt?: string; location?: string | null };
};
