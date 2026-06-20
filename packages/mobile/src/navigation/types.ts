// Typed route params for @react-navigation (Contract Matrix M1; the new design's
// tab structure). The root native-stack hosts Login, the bottom-tab area, and the
// pushed flows: the learning path (Level → Lesson → Quiz → LevelComplete), the
// full calendar browse, and the Event detail. The five primary destinations are
// Home · Pathway · Give · Community · Profile.
import type { NavigatorScreenParams } from "@react-navigation/native";

export type TabParamList = {
  Home: undefined;
  Pathway: undefined;
  Events: undefined;
  Chat: undefined;
  Give: undefined;
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
  GivingStatement: undefined; // full grouped giving history (Give make)
  Calendar: undefined; // full browse, pushed from Home's Upcoming section
  Thread: { threadId: string; title?: string }; // cohort discussion detail (M2)
  CohortDiscussions: undefined; // cohort thread board (D3, pushed from Community)
  Gifts: undefined; // spiritual-gifts assessment + results (M3)
  PrayerJournal: undefined; // private journal (M3)
  VerseLibrary: undefined; // saved verses (M3)
  Notifications: undefined; // notification center (D1)
  ChatThread: { conversationId: string; title?: string }; // DM/group/space thread (Chat make)
  SpacePreview: { conversationId: string; title?: string }; // public space preview + join
  NewMessage: undefined; // DM directory / compose picker (Chat make)
  Nuru: undefined; // AI assistant (Chat make)
  Devotional: undefined; // daily devotional (D5)
  MemoryVerses: undefined; // memory-verse library (D5)
  ReadingPlans: undefined; // reading plans list (D5)
  PlanDetail: { planId: string; title?: string }; // reading-plan detail (D5)
  Mentor: undefined; // discipler + meeting notes (D5)
  Resources: undefined; // resource library (D5)
  EventDetail: { eventId: string; title: string; startAt: string; endAt?: string; location?: string | null };
};
