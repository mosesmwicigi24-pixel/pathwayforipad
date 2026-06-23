// Typed data hooks for the screens. Each wraps NuruApi in the tiny query cache
// with a stable key so writes can invalidate exactly what they touched.
import type { MeResponse } from "@nuru/shared";
import { NuruApi } from "./client";
import { useQuery, type QueryResult } from "./query";
import type {
  Achievements,
  AssembledQuiz,
  CalendarOccurrence,
  EventSeries,
  CellSummary,
  CertificateRow,
  EventDetail,
  GivingRecord,
  GivingDetail,
  GiftQuestion,
  GivingSchedule,
  MyAnnouncement,
  MyGifts,
  MyReflection,
  MyRsvp,
  Devotional,
  MemoryVerseRow,
  ReadingPlanRow,
  ReadingPlanDetail,
  ResourceRow,
  MentorInfo,
  Discipler,
  GrowthScore,
  ScoresSummary,
  NextAction,
  NotificationRow,
  ScripturePassage,
  WelcomeVideo,
  FeaturedCell,
  RhythmToday,
  AnnouncementDetail,
  FeaturedEvent,
  FeaturedAnnouncement,
  LevelModule,
  LevelEncouragement,
  ModuleDetail,
  PathwaySummary,
  PrayerEntry,
  SavedVerse,
  ThreadDetail,
  ThreadSummary,
  ChatInbox,
  ChatThreadDetail,
  ChatPerson,
} from "./types";

export const queryKeys = {
  me: "me",
  pathway: "pathway",
  levelModules: (n: number) => `levelModules:${n}`,
  levelEncouragements: (n: number) => `levelEncouragements:${n}`,
  module: (id: string) => `module:${id}`,
  quiz: (id: string) => `quiz:${id}`,
  calendar: (from: string, to: string) => `calendar:${from}:${to}`,
  event: (id: string) => `event:${id}`,
  myRsvps: "myRsvps",
  devotional: "devotional",
  memoryVerses: "memoryVerses",
  plans: "plans",
  plan: (id: string) => `plan:${id}`,
  resources: "resources",
  mentor: "mentor",
  giving: "giving",
  givingDetail: (id: string) => `giving:${id}`,
  schedules: "schedules",
  achievements: "achievements",
  threads: "threads",
  thread: (id: string) => `thread:${id}`,
  chatInbox: "chatInbox",
  chatConvo: (id: string) => `chatConvo:${id}`,
  chatPeople: (q: string) => `chatPeople:${q}`,
  giftQuestions: "giftQuestions",
  myGifts: "myGifts",
  prayers: "prayers",
  verses: "verses",
  myReflection: (moduleId: string) => `myReflection:${moduleId}`,
  notifications: "notifications",
  myAnnouncements: "myAnnouncements",
  eventSeries: "eventSeries",
  cellSummary: "cellSummary",
  scripture: (ref: string, version: string) => `scripture:${ref}:${version}`,
  welcomeVideo: "welcomeVideo",
  featuredCell: "featuredCell",
  rhythmToday: "rhythmToday",
  featuredEvent: "featuredEvent",
  featuredAnnouncement: "featuredAnnouncement",
  disciplers: "disciplers",
  wordScore: "wordScore",
  scores: "scores",
  nextAction: "nextAction",
  announcement: (id: string) => `announcement:${id}`,
  certificates: "certificates",
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

// A level's CMS-managed trail encouragements. Non-critical content — failures
// resolve to an empty list so the trail still renders without them.
export function useLevelEncouragements(levelNumber: number | null): QueryResult<LevelEncouragement[]> {
  return useQuery(
    levelNumber ? queryKeys.levelEncouragements(levelNumber) : null,
    () => NuruApi.levelEncouragements(levelNumber as number),
    { staleMs: 60_000 },
  );
}

export function useModule(moduleId: string | null): QueryResult<ModuleDetail> {
  // Short stale window so an admin edit to the lesson shows up almost immediately
  // (ModuleScreen also refetches on focus + polls while open).
  return useQuery(moduleId ? queryKeys.module(moduleId) : null, () => NuruApi.module(moduleId as string), {
    staleMs: 10_000,
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

export function useGivingDetail(transactionId: string | null): QueryResult<GivingDetail> {
  return useQuery(transactionId ? queryKeys.givingDetail(transactionId) : null, () => NuruApi.givingDetail(transactionId as string), { staleMs: 60_000 });
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

export function useChatInbox(): QueryResult<ChatInbox> {
  return useQuery(queryKeys.chatInbox, () => NuruApi.chatInbox(), { staleMs: 10_000 });
}

export function useChatConversation(conversationId: string | null): QueryResult<ChatThreadDetail> {
  return useQuery(
    conversationId ? queryKeys.chatConvo(conversationId) : null,
    () => NuruApi.chatConversation(conversationId ?? ""),
    { staleMs: 5_000 },
  );
}

export function useChatPeople(query: string): QueryResult<{ people: ChatPerson[] }> {
  return useQuery(queryKeys.chatPeople(query), () => NuruApi.chatPeople(query || undefined), { staleMs: 30_000 });
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

export function useEventSeries(): QueryResult<EventSeries[]> {
  return useQuery(queryKeys.eventSeries, () => NuruApi.eventSeries(), { staleMs: 60_000 });
}

export function useCellSummary(): QueryResult<CellSummary> {
  return useQuery(queryKeys.cellSummary, () => NuruApi.cellSummary(), { staleMs: 60_000 });
}

/** Verse of the day (WEB default per D-M4 — public-domain translation). */
export function useScripture(ref: string, version = "WEB"): QueryResult<ScripturePassage> {
  return useQuery(queryKeys.scripture(ref, version), () => NuruApi.scripture(ref, version), {
    staleMs: 24 * 60 * 60 * 1000,
  });
}

/** Homepage welcome video (PR #120); data is null when none is configured. */
export function useWelcomeVideo(): QueryResult<WelcomeVideo | null> {
  return useQuery(queryKeys.welcomeVideo, () => NuruApi.welcomeVideo(), { staleMs: 5 * 60_000 });
}

/** Homepage-featured cell "This week at Nuru" (PR #125); null when none is set. */
export function useFeaturedCell(): QueryResult<FeaturedCell | null> {
  return useQuery(queryKeys.featuredCell, () => NuruApi.featuredCell(), { staleMs: 5 * 60_000 });
}

/** Today's Rhythm completions (prayer / word / reflection). */
export function useRhythmToday(): QueryResult<RhythmToday> {
  return useQuery(queryKeys.rhythmToday, () => NuruApi.rhythmToday(), { staleMs: 60_000 });
}

/** Full announcement detail (carousel images + body). */
export function useAnnouncement(id: string | null): QueryResult<AnnouncementDetail> {
  return useQuery(id ? queryKeys.announcement(id) : null, () => NuruApi.announcement(id as string), { staleMs: 60_000 });
}

/** Homepage-featured event / announcement (null when none is set). */
export function useFeaturedEvent(): QueryResult<FeaturedEvent | null> {
  return useQuery(queryKeys.featuredEvent, () => NuruApi.featuredEvent(), { staleMs: 5 * 60_000 });
}
export function useFeaturedAnnouncement(): QueryResult<FeaturedAnnouncement | null> {
  return useQuery(queryKeys.featuredAnnouncement, () => NuruApi.featuredAnnouncement(), { staleMs: 5 * 60_000 });
}

/** Member's earned certificates (real + verifiable; GET /certificates). */
export function useCertificates(): QueryResult<CertificateRow[]> {
  return useQuery(queryKeys.certificates, () => NuruApi.certificates(), { staleMs: 60_000 });
}

export function useMyRsvps(): QueryResult<MyRsvp[]> {
  return useQuery(queryKeys.myRsvps, () => NuruApi.myRsvps(), { staleMs: 30_000 });
}

export function useDevotional(): QueryResult<Devotional> {
  return useQuery(queryKeys.devotional, () => NuruApi.devotional(), { staleMs: 60 * 60 * 1000 });
}
export function useMemoryVerses(): QueryResult<MemoryVerseRow[]> {
  return useQuery(queryKeys.memoryVerses, () => NuruApi.memoryVerses(), { staleMs: 30_000 });
}
export function usePlans(): QueryResult<ReadingPlanRow[]> {
  return useQuery(queryKeys.plans, () => NuruApi.plans(), { staleMs: 30_000 });
}
export function usePlan(planId: string | null): QueryResult<ReadingPlanDetail> {
  return useQuery(planId ? queryKeys.plan(planId) : null, () => NuruApi.plan(planId ?? ""), { staleMs: 15_000 });
}
export function useResources(): QueryResult<ResourceRow[]> {
  return useQuery(queryKeys.resources, () => NuruApi.resources(), { staleMs: 5 * 60_000 });
}
export function useMentor(): QueryResult<MentorInfo> {
  return useQuery(queryKeys.mentor, () => NuruApi.mentor(), { staleMs: 60_000 });
}
/** Disciplers/mentors in my congregation (Home "Meet your discipler" carousel). */
export function useDisciplers(): QueryResult<Discipler[]> {
  return useQuery(queryKeys.disciplers, () => NuruApi.disciplers(), { staleMs: 5 * 60_000 });
}
/** My Word score (consistency + memorization + breadth). */
export function useWordScore(): QueryResult<GrowthScore> {
  return useQuery(queryKeys.wordScore, () => NuruApi.wordScore(), { staleMs: 30_000 });
}
/** All five growth scores + a weighted overall (Home "Your progress"). */
export function useScores(): QueryResult<ScoresSummary> {
  return useQuery(queryKeys.scores, () => NuruApi.scores(), { staleMs: 30_000 });
}
/** The server-decided next-best-action hero for Home. */
export function useNextAction(): QueryResult<{ action: NextAction | null }> {
  return useQuery(queryKeys.nextAction, () => NuruApi.nextAction(), { staleMs: 60_000 });
}
