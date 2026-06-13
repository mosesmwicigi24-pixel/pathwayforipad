// Typed data hooks for the screens. Each wraps NuruApi in the tiny query cache
// with a stable key so writes can invalidate exactly what they touched.
import type { MeResponse } from "@nuru/shared";
import { NuruApi } from "./client";
import { useQuery, type QueryResult } from "./query";
import type {
  Achievements,
  AssembledQuiz,
  CalendarOccurrence,
  EventDetail,
  GivingRecord,
  GiftQuestion,
  GivingSchedule,
  MyAnnouncement,
  MyGifts,
  MyReflection,
  NotificationRow,
  ScripturePassage,
  LevelModule,
  ModuleDetail,
  PathwaySummary,
  PrayerEntry,
  SavedVerse,
  ThreadDetail,
  ThreadSummary,
} from "./types";

export const queryKeys = {
  me: "me",
  pathway: "pathway",
  levelModules: (n: number) => `levelModules:${n}`,
  module: (id: string) => `module:${id}`,
  quiz: (id: string) => `quiz:${id}`,
  calendar: (from: string, to: string) => `calendar:${from}:${to}`,
  event: (id: string) => `event:${id}`,
  giving: "giving",
  schedules: "schedules",
  achievements: "achievements",
  threads: "threads",
  thread: (id: string) => `thread:${id}`,
  giftQuestions: "giftQuestions",
  myGifts: "myGifts",
  prayers: "prayers",
  verses: "verses",
  myReflection: (moduleId: string) => `myReflection:${moduleId}`,
  notifications: "notifications",
  myAnnouncements: "myAnnouncements",
  scripture: (ref: string, version: string) => `scripture:${ref}:${version}`,
};

export function useMe(): QueryResult<MeResponse> {
  return useQuery(queryKeys.me, () => NuruApi.me(), { staleMs: 60_000 });
}

export function usePathway(): QueryResult<PathwaySummary> {
  return useQuery(queryKeys.pathway, () => NuruApi.pathway(), { staleMs: 15_000 });
}

export function useLevelModules(levelNumber: number | null): QueryResult<LevelModule[]> {
  return useQuery(
    levelNumber ? queryKeys.levelModules(levelNumber) : null,
    () => NuruApi.levelModules(levelNumber as number),
    { staleMs: 15_000 },
  );
}

export function useModule(moduleId: string | null): QueryResult<ModuleDetail> {
  return useQuery(moduleId ? queryKeys.module(moduleId) : null, () => NuruApi.module(moduleId as string), {
    staleMs: 300_000,
  });
}

export function useQuiz(moduleId: string | null): QueryResult<AssembledQuiz> {
  // staleMs 0: re-assemble a fresh (re-randomized) quiz each open.
  return useQuery(moduleId ? queryKeys.quiz(moduleId) : null, () => NuruApi.quiz(moduleId as string), {
    staleMs: 0,
  });
}

export function useCalendar(from: string, to: string): QueryResult<CalendarOccurrence[]> {
  return useQuery(queryKeys.calendar(from, to), () => NuruApi.calendar(from, to), { staleMs: 60_000 });
}

export function useEvent(eventId: string | null): QueryResult<EventDetail> {
  return useQuery(eventId ? queryKeys.event(eventId) : null, () => NuruApi.event(eventId as string));
}

export function useGivingHistory(): QueryResult<GivingRecord[]> {
  return useQuery(queryKeys.giving, () => NuruApi.givingHistory(), { staleMs: 30_000 });
}

export function useAchievements(): QueryResult<Achievements> {
  return useQuery(queryKeys.achievements, () => NuruApi.achievements(), { staleMs: 60_000 });
}

export function useSchedules(): QueryResult<GivingSchedule[]> {
  return useQuery(queryKeys.schedules, () => NuruApi.schedules(), { staleMs: 30_000 });
}

export function useThreads(): QueryResult<ThreadSummary[]> {
  return useQuery(queryKeys.threads, () => NuruApi.threads(), { staleMs: 15_000 });
}

export function useThread(threadId: string | null): QueryResult<ThreadDetail> {
  return useQuery(threadId ? queryKeys.thread(threadId) : null, () => NuruApi.thread(threadId ?? ""), {
    staleMs: 10_000,
  });
}

export function useGiftQuestions(): QueryResult<GiftQuestion[]> {
  return useQuery(queryKeys.giftQuestions, () => NuruApi.giftQuestions(), { staleMs: 300_000 });
}

export function useMyGifts(): QueryResult<MyGifts> {
  return useQuery(queryKeys.myGifts, () => NuruApi.myGifts(), { staleMs: 60_000 });
}

export function usePrayers(): QueryResult<PrayerEntry[]> {
  return useQuery(queryKeys.prayers, () => NuruApi.prayers(), { staleMs: 15_000 });
}

export function useVerses(): QueryResult<SavedVerse[]> {
  return useQuery(queryKeys.verses, () => NuruApi.verses(), { staleMs: 30_000 });
}

/** Review state for a reflection-gated module; null until one is submitted. */
export function useMyReflection(moduleId: string | null): QueryResult<MyReflection | null> {
  return useQuery(moduleId ? queryKeys.myReflection(moduleId) : null, () => NuruApi.myReflection(moduleId ?? ""), {
    staleMs: 15_000,
  });
}

export function useNotifications(): QueryResult<{ data: NotificationRow[]; unread: number }> {
  return useQuery(queryKeys.notifications, () => NuruApi.notifications(), { staleMs: 20_000 });
}

export function useMyAnnouncements(): QueryResult<MyAnnouncement[]> {
  return useQuery(queryKeys.myAnnouncements, () => NuruApi.myAnnouncements(), { staleMs: 30_000 });
}

/** Verse of the day (WEB default per D-M4 — public-domain translation). */
export function useScripture(ref: string, version = "WEB"): QueryResult<ScripturePassage> {
  return useQuery(queryKeys.scripture(ref, version), () => NuruApi.scripture(ref, version), {
    staleMs: 24 * 60 * 60 * 1000,
  });
}
