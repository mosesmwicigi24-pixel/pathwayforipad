// Typed route params for @react-navigation (Contract Matrix M1; the new design's
// tab structure). The root native-stack hosts Login, the bottom-tab area, and the
// pushed flows: the learning path (Level → Lesson → Quiz → LevelComplete), the
// full calendar browse, and the Event detail. The five primary destinations are
// Home · Pathway · Give · Community · Profile.
import type { NavigatorScreenParams } from "@react-navigation/native";

export type TabParamList = {
  Home: undefined;
  Pathway: undefined;
  Give: undefined;
  Community: undefined;
  Profile: undefined;
};

export type RootStackParamList = {
  Login: undefined;
  Tabs: NavigatorScreenParams<TabParamList> | undefined;
  Level: { levelId: number };
  Module: { moduleId: string };
  Quiz: { moduleId: string };
  LevelComplete: undefined;
  Giving: undefined; // legacy push target (Profile rows); the Give tab is primary
  Calendar: undefined; // full browse, pushed from Home's Upcoming section
  Thread: { threadId: string; title?: string }; // cohort discussion detail (M2)
  CohortDiscussions: undefined; // cohort thread board (D3, pushed from Community)
  Gifts: undefined; // spiritual-gifts assessment + results (M3)
  PrayerJournal: undefined; // private journal (M3)
  VerseLibrary: undefined; // saved verses (M3)
  Notifications: undefined; // notification center (D1)
  EventDetail: { eventId: string; title: string; startAt: string; endAt?: string; location?: string | null };
};
