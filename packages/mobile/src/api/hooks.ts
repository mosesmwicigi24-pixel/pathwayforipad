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
  LevelModule,
  ModuleDetail,
  PathwaySummary,
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
  achievements: "achievements",
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
