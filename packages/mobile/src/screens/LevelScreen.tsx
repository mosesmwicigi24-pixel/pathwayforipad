// Level detail — the Figma "PathwayTab" module trail, now fully DB-backed. A
// full-bleed level hero, a progress snapshot, the discipler card (real mentor via
// useMentor), the vertical module trail (real modules via useLevelModules) with
// interspersed CMS-managed encouragements (useLevelEncouragements), and a
// "what comes next" level card. Server stays authoritative for unlocking (§1.9) —
// a locked tap shows a gentle toast. Hero imagery is decorative.
import { useState, type ReactElement } from "react";
import { Image, Pressable, ScrollView, View } from "react-native";
import {
  ArrowLeft, BookOpen, Check, ChevronRight, Clock, Lock,
  MessageCircle, PenLine, PlayCircle, Quote, Video, type LucideIcon,
} from "lucide-react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { palette, radii, spacing, shadow } from "../theme/tokens";
import { T } from "../theme/components";
import { useLevelModules, usePathway, useMentor, useLevelEncouragements } from "../api/hooks";
import { errorMessage } from "../api/query";
import { Loading, ErrorState, Empty } from "../components/states";
import { FitImage } from "../components/FitImage";
import type { LevelModule, LevelEncouragement } from "../api/types";

const NAVY = palette.navy;
const GOLD = palette.gold;

// Decorative hero imagery only (no per-level art in the data yet).
const IMG_BIBLE = "https://images.unsplash.com/photo-1497621122273-f5cfb6065c56?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=1080";
const IMG_WORSHIP = "https://images.unsplash.com/photo-1510384742052-1abcb6282645?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=1080";
const IMG_GATHERING = "https://images.unsplash.com/photo-1444664361762-afba083a4d77?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=1080";
const LEVEL_HERO: Record<number, string> = { 1: IMG_BIBLE, 2: IMG_WORSHIP, 3: IMG_GATHERING, 4: IMG_WORSHIP, 5: IMG_BIBLE, 6: IMG_GATHERING };

type Status = "completed" | "next" | "locked";

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "·";
}
function formatNext(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { weekday: "short" }) + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function LevelScreen(): ReactElement {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { levelId } = useRoute<RouteProp<RootStackParamList, "Level">>().params;
  const { data: modules, isLoading, error, refetch } = useLevelModules(levelId);
  const { data: pathway } = usePathway();
  const { data: mentorInfo } = useMentor();
  const { data: encouragements } = useLevelEncouragements(levelId);
  const [toast, setToast] = useState<string | null>(null);

  const meta = pathway?.levels.find((l) => l.level_number === levelId);
  const levelsCount = pathway?.levels.length ?? 6;
  const completed = modules?.filter((m) => m.completed).length ?? meta?.completed_modules ?? 0;
  const total = modules?.length ?? meta?.total_modules ?? 0;
  const minutes = modules?.reduce((s, m) => s + (m.estimated_minutes ?? 0), 0) ?? meta?.minutes ?? 0;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const isComplete = total > 0 && completed >= total;
  const hero = LEVEL_HERO[levelId] ?? IMG_WORSHIP;
  const nextMeta = pathway?.levels.find((l) => l.level_number === levelId + 1) ?? null;

  // Real, CMS-managed trail content. The first "note" with a reference becomes the
  // Word-of-God card; the rest interleave between modules by trail position.
  const encs = encouragements ?? [];
  const verseEnc = encs.find((e) => e.kind === "note" && (e.scripture_ref || e.body)) ?? null;
  const trailEncs = encs.filter((e) => e !== verseEnc);
  const preTrail = trailEncs.filter((e) => e.after_module_sequence <= 0);
  const encsAfter = (seq: number): LevelEncouragement[] => trailEncs.filter((e) => e.after_module_sequence === seq);

  const mentor = mentorInfo?.mentor ?? null;
  const mentorNext = formatNext(mentorInfo?.next_meeting_at ?? null);

  function showToast(msg: string): void {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  }

  const tapModule = (mod: LevelModule, index: number): void => {
    if (mod.locked) {
      showToast(`Complete “${modules?.[index - 1]?.title ?? "the previous module"}” first`);
      return;
    }
    nav.navigate("Module", { moduleId: mod.module_id });
  };

  return (
    <View style={st.screen}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing.xxl }}>
        {/* Full-bleed hero — cover image shown in FULL (container adapts) */}
        <FitImage uri={hero} background={palette.navy} style={st.heroFit}>
          <View style={st.heroShade} />
          <View style={st.heroTop}>
            <Pressable onPress={() => nav.goBack()} style={({ pressed }) => [st.glassBtn, pressed && st.press]} accessibilityRole="button" accessibilityLabel="Back">
              <ArrowLeft size={20} color={palette.onNavy} />
            </Pressable>
          </View>
          <View style={st.heroFill}>
            <View style={st.heroBottom}>
              <View style={{ flexDirection: "row", gap: 6 }}>
                <View style={st.lvlBadge}><T variant="micro" style={{ color: NAVY, fontWeight: "700", letterSpacing: 1.2 }}>{`LEVEL ${levelId} OF ${levelsCount}`}</T></View>
                <View style={[st.statusBadge, { backgroundColor: isComplete ? "#16A34A" : "rgba(255,255,255,0.22)" }]}>
                  <T variant="micro" style={{ color: palette.white, fontWeight: "700", letterSpacing: 1 }}>{isComplete ? "COMPLETE" : "IN PROGRESS"}</T>
                </View>
              </View>
              <T serif tone="onNavy" style={{ fontSize: 26, lineHeight: 30, marginTop: spacing.sm, fontWeight: "600" }}>{meta?.title ?? `Level ${levelId}`}</T>
              {meta?.theme ? <T variant="caption" tone="onNavyDim" style={{ marginTop: 4 }}>{meta.theme}</T> : null}
            </View>
          </View>
        </FitImage>

        <View style={{ paddingHorizontal: spacing.screen }}>
          {/* Progress snapshot — overlaps the hero */}
          <View style={st.snapshot}>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <T variant="caption" style={{ color: NAVY, fontWeight: "600" }}>{`${completed} of ${total} modules`}</T>
              <T variant="caption" style={{ color: GOLD, fontWeight: "700" }}>{`${pct}%`}</T>
            </View>
            <View style={st.snapTrack}><View style={[st.snapFill, { width: `${pct}%` }]} /></View>
            <View style={{ flexDirection: "row", gap: 6, marginTop: spacing.sm }}>
              <MetaChip Icon={Clock} label={`≈ ${minutes} min`} />
              <MetaChip Icon={BookOpen} label={`${total} lessons`} />
            </View>
          </View>

          {/* Word of God (from CMS encouragement note) */}
          {verseEnc ? (
            <View style={[st.verseCard, { marginTop: spacing.base }]}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                <Quote size={11} color="#A8861C" />
                <T variant="micro" style={{ color: "#A8861C", fontWeight: "700", letterSpacing: 1.4 }}>{(verseEnc.title ?? "A WORD TO CARRY YOU").toUpperCase()}</T>
              </View>
              {verseEnc.body ? <T serif style={{ fontSize: 15, lineHeight: 22, color: NAVY, marginTop: spacing.sm }}>{`“${verseEnc.body}”`}</T> : null}
              {verseEnc.scripture_ref ? <T variant="micro" style={{ color: "#A8861C", fontWeight: "700", marginTop: 6 }}>{verseEnc.scripture_ref}</T> : null}
            </View>
          ) : null}

          {/* Discipler — real mentor (useMentor) */}
          <Pressable onPress={() => nav.navigate("Mentor")} style={({ pressed }) => [st.disciplerCard, { marginTop: spacing.base }, pressed && st.press]} accessibilityRole="button">
            <View style={st.disciplerAvatar}><T variant="caption" style={{ color: palette.white, fontWeight: "700" }}>{mentor ? initials(mentor.full_name) : "·"}</T></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <T variant="micro" style={{ color: "#A8861C", fontWeight: "700", letterSpacing: 1.2 }}>WALK IT WITH YOUR DISCIPLER</T>
              <T variant="caption" style={{ color: NAVY, fontWeight: "700", marginTop: 1 }} numberOfLines={1}>{mentor?.full_name ?? "A discipler will walk with you"}</T>
              <T variant="micro" tone="tertiary" numberOfLines={1}>
                {mentor ? [mentor.cell_name, mentorNext ? `next ${mentorNext}` : null].filter(Boolean).join(" · ") || "Tap to open" : "Tap to learn more"}
              </T>
            </View>
            <View style={st.chatBtn}><MessageCircle size={13} color={palette.onNavy} /><T variant="micro" style={{ color: palette.onNavy, fontWeight: "600" }}>Chat</T></View>
          </Pressable>

          {/* Trail header */}
          <View style={st.listHead}>
            <View>
              <T variant="overline" tone="secondary">YOUR MODULE TRAIL</T>
              <T variant="title" style={{ marginTop: 2 }}>Learn step by step</T>
            </View>
            <View style={st.countPill}><T variant="caption" tone="secondary">{`${total} lessons`}</T></View>
          </View>

          {/* Pre-trail encouragements (position 0) */}
          {preTrail.map((e) => (
            <View key={e.encouragement_id} style={{ marginBottom: spacing.md }}><TrailEncouragement enc={e} /></View>
          ))}

          {isLoading ? (
            <Loading label="Loading modules…" />
          ) : error ? (
            <ErrorState message={errorMessage(error)} onRetry={() => void refetch()} />
          ) : !modules || modules.length === 0 ? (
            <Empty title="No published lessons yet" subtitle="Check back soon — content is being prepared for this level." />
          ) : (
            <View>
              {modules.map((m, i) => {
                const status: Status = m.completed ? "completed" : m.locked ? "locked" : "next";
                const last = i === modules.length - 1;
                const interludes = encsAfter(m.module_sequence_number);
                return (
                  <View key={m.module_id} style={{ flexDirection: "row", gap: spacing.md }}>
                    <View style={{ alignItems: "center" }}>
                      <TrailNode status={status} index={m.module_sequence_number} />
                      {!last ? <View style={[st.connector, { backgroundColor: status === "completed" ? GOLD : "rgba(10,37,64,0.10)" }]} /> : null}
                    </View>
                    <View style={{ flex: 1, minWidth: 0, paddingBottom: last ? 0 : spacing.md }}>
                      <ModuleStation module={m} status={status} onTap={() => tapModule(m, i)} />
                      {interludes.map((e) => (
                        <View key={e.encouragement_id} style={{ marginTop: spacing.sm }}><TrailEncouragement enc={e} /></View>
                      ))}
                    </View>
                  </View>
                );
              })}
            </View>
          )}

          {/* What comes next */}
          {nextMeta ? (
            <Pressable
              onPress={() => (isComplete ? nav.navigate("Level", { levelId: nextMeta.level_number }) : showToast(`Finish Level ${levelId} to unlock the next level`))}
              style={({ pressed }) => [st.nextCard, isComplete ? { backgroundColor: NAVY } : { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border }, pressed && st.press]}
              accessibilityRole="button"
            >
              <View style={[st.nextBadge, { backgroundColor: isComplete ? "rgba(255,255,255,0.2)" : palette.mutedBg }]}>
                {isComplete ? <T variant="caption" style={{ color: palette.white, fontWeight: "800" }}>{`L${nextMeta.level_number}`}</T> : <Lock size={16} color={palette.ink400} />}
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <T variant="micro" style={{ color: isComplete ? "rgba(255,255,255,0.8)" : "#A8861C", fontWeight: "700", letterSpacing: 1 }}>{`UP NEXT · LEVEL ${nextMeta.level_number}`}</T>
                <T serif style={{ fontSize: 15, color: isComplete ? palette.white : NAVY, fontWeight: "600", marginTop: 1 }} numberOfLines={1}>{nextMeta.title}</T>
                <T variant="micro" style={{ color: isComplete ? "rgba(255,255,255,0.7)" : palette.ink400, marginTop: 1 }} numberOfLines={1}>
                  {isComplete ? (nextMeta.theme ?? "Continue your journey") : `Unlocks when you finish this level · ${nextMeta.total_modules} modules`}
                </T>
              </View>
              {isComplete ? <ChevronRight size={18} color={palette.white} /> : <Lock size={15} color={palette.ink400} />}
            </Pressable>
          ) : (
            <View style={st.finalRow}>
              <View style={st.finalDash} />
              <T variant="micro" tone="tertiary" style={{ fontWeight: "700", letterSpacing: 1.4 }}>THE FINAL ASCENT</T>
              <View style={st.finalDash} />
            </View>
          )}
        </View>
      </ScrollView>

      {toast ? (
        <View style={st.toast}><T variant="body" tone="onNavy" style={{ textAlign: "center" }}>{toast}</T></View>
      ) : null}
    </View>
  );
}

function TrailNode({ status, index }: { status: Status; index: number }): ReactElement {
  const done = status === "completed";
  const active = status === "next";
  return (
    <View style={[st.node, { backgroundColor: done || active ? GOLD : palette.mutedBg, borderWidth: active ? 2 : 0, borderColor: NAVY }]}>
      {done ? <Check size={17} color={NAVY} /> : active ? <PlayCircle size={17} color={NAVY} /> : <Lock size={13} color={palette.ink400} />}
      {!done && !active ? <View style={st.nodeNum}><T variant="micro" style={{ color: palette.ink400, fontWeight: "800", fontSize: 8 }}>{index}</T></View> : null}
    </View>
  );
}

function ModuleStation({ module, status, onTap }: { module: LevelModule; status: Status; onTap: () => void }): ReactElement {
  const done = status === "completed";
  const active = status === "next";
  const locked = status === "locked";
  return (
    <Pressable
      onPress={onTap}
      style={({ pressed }) => [st.station, locked ? { backgroundColor: palette.surface, opacity: 0.85 } : { backgroundColor: palette.white }, active && { borderColor: "rgba(201,162,39,0.5)" }, pressed && !locked && st.press]}
      accessibilityRole="button"
      accessibilityLabel={`Module ${module.module_sequence_number}: ${module.title}${locked ? ", locked" : ""}`}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: spacing.sm }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <T variant="micro" style={{ color: "#A8861C", fontWeight: "700", letterSpacing: 1.2 }}>{`MODULE ${module.module_sequence_number}`}</T>
          <T serif style={{ fontSize: 15, color: NAVY, fontWeight: "600", marginTop: 1 }} numberOfLines={1}>{module.title}</T>
        </View>
        <StationPill status={status} />
      </View>
      {module.summary ? <T variant="micro" tone="secondary" style={{ marginTop: 4, lineHeight: 16 }} numberOfLines={2}>{module.summary}</T> : null}
      {done || active ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.sm }}>
          <View style={st.miniTrack}><View style={{ width: `${module.progress}%`, height: "100%", borderRadius: 3, backgroundColor: done ? GOLD : NAVY }} /></View>
          <T variant="micro" tone="tertiary">{`${module.progress}%`}</T>
        </View>
      ) : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 5, marginTop: spacing.sm }}>
        <MetaChip Icon={Clock} label={`${module.estimated_minutes ?? 0} min`} />
        {module.evaluation_kind === "quiz" ? <MetaChip Icon={Video} label="Quiz" /> : null}
        {module.evaluation_kind === "reflection" ? <MetaChip Icon={PenLine} label="Reflection" gold /> : null}
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm, marginTop: spacing.sm }}>
        <T serif style={{ fontSize: 11, fontStyle: "italic", color: done ? "#7a5a14" : active ? "#A8861C" : palette.ink400, flex: 1 }} numberOfLines={1}>
          {done ? "Completed — nicely done." : active ? "Pick up where you left off." : "Unlocks when you finish the one before."}
        </T>
        {active ? <View style={st.resumePill}><T variant="micro" style={{ color: GOLD, fontWeight: "700" }}>Resume</T><ChevronRight size={12} color={GOLD} /></View> : null}
        {done ? <ChevronRight size={15} color={palette.ink300} /> : null}
      </View>
    </Pressable>
  );
}

function StationPill({ status }: { status: Status }): ReactElement {
  const map = {
    completed: { label: "Done", bg: "#DCFCE7", fg: "#166534" },
    next: { label: "In progress", bg: "rgba(201,162,39,0.14)", fg: "#7a5a14" },
    locked: { label: "Locked", bg: palette.mutedBg, fg: palette.ink400 },
  } as const;
  const s = map[status];
  return <View style={[st.statPill, { backgroundColor: s.bg }]}><T variant="micro" style={{ color: s.fg, fontWeight: "700", letterSpacing: 0.6 }}>{s.label.toUpperCase()}</T></View>;
}

function MetaChip({ Icon, label, gold }: { Icon: LucideIcon; label: string; gold?: boolean }): ReactElement {
  return (
    <View style={[st.metaChip, gold && { backgroundColor: "rgba(201,162,39,0.14)" }]}>
      <Icon size={9} color={gold ? "#A8861C" : "#68758A"} />
      <T variant="micro" style={{ color: gold ? "#A8861C" : "#68758A", fontWeight: "600" }}>{label}</T>
    </View>
  );
}

// Real, CMS-managed encouragement rendered by kind.
function TrailEncouragement({ enc }: { enc: LevelEncouragement }): ReactElement {
  if (enc.kind === "splash") {
    return (
      <View style={st.splash}>
        {enc.image_url ? <Image source={{ uri: enc.image_url }} style={st.splashImg} resizeMode="cover" /> : null}
        <View style={st.splashShade} />
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
          {enc.emoji ? <T style={{ fontSize: 30 }}>{enc.emoji}</T> : null}
          <View style={{ flex: 1, minWidth: 0 }}>
            {enc.title ? <T serif tone="onNavy" style={{ fontSize: 18, lineHeight: 22, fontWeight: "600" }}>{enc.title}</T> : null}
            {enc.body ? <T variant="micro" style={{ color: "rgba(255,255,255,0.8)", marginTop: 2, lineHeight: 15 }}>{enc.body}</T> : null}
          </View>
        </View>
      </View>
    );
  }
  if (enc.kind === "sticker") {
    const stickers = (enc.emoji ?? "🎉").split(/\s+/).filter(Boolean);
    return (
      <View style={[st.encRow, { backgroundColor: "rgba(201,162,39,0.10)", borderColor: "rgba(201,162,39,0.33)" }]}>
        <View style={{ flexDirection: "row" }}>
          {stickers.map((s, i) => (
            <View key={i} style={[st.sticker, { marginLeft: i === 0 ? 0 : -6, transform: [{ rotate: `${(i % 2 === 0 ? -1 : 1) * (6 + i * 2)}deg` }] }]}><T style={{ fontSize: 16 }}>{s}</T></View>
          ))}
        </View>
        <T serif style={{ flex: 1, fontSize: 11, fontStyle: "italic", color: "#7a5a14", marginLeft: spacing.sm }}>{enc.body ?? enc.title ?? ""}</T>
      </View>
    );
  }
  if (enc.kind === "note") {
    return (
      <View style={[st.verseCard, { padding: spacing.md }]}>
        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          <View style={st.verseIcon}><Quote size={13} color={GOLD} /></View>
          <View style={{ flex: 1, minWidth: 0 }}>
            {enc.body ? <T serif style={{ fontSize: 12, color: NAVY, lineHeight: 17 }}>{`“${enc.body}”`}</T> : null}
            {enc.scripture_ref ? <T variant="micro" style={{ color: "#A8861C", fontWeight: "700", marginTop: 2 }}>{enc.scripture_ref}</T> : null}
          </View>
        </View>
      </View>
    );
  }
  // cheer
  return (
    <View style={[st.encRow, { backgroundColor: "rgba(201,162,39,0.12)", borderColor: "rgba(201,162,39,0.4)" }]}>
      {enc.emoji ? <View style={st.encEmoji}><T style={{ fontSize: 20 }}>{enc.emoji}</T></View> : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        {enc.title ? <T serif style={{ fontSize: 13, color: NAVY, fontWeight: "600" }} numberOfLines={1}>{enc.title}</T> : null}
        {enc.body ? <T variant="micro" tone="secondary" style={{ marginTop: 1 }}>{enc.body}</T> : null}
      </View>
    </View>
  );
}

const st = {
  screen: { flex: 1, backgroundColor: "#F4F0E8" },
  hero: { height: 240, overflow: "hidden", borderBottomLeftRadius: 28, borderBottomRightRadius: 28, justifyContent: "space-between" },
  heroFit: { borderBottomLeftRadius: 28, borderBottomRightRadius: 28, minHeight: 220 },
  heroFill: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, justifyContent: "space-between" },
  heroShade: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(8,28,54,0.5)" },
  heroTop: { flexDirection: "row", paddingHorizontal: spacing.screen, paddingTop: 52 },
  glassBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(0,0,0,0.35)", alignItems: "center", justifyContent: "center" },
  heroBottom: { padding: spacing.screen },
  lvlBadge: { backgroundColor: GOLD, borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 4 },
  statusBadge: { borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 4 },
  snapshot: { backgroundColor: palette.white, borderRadius: 22, borderWidth: 1, borderColor: palette.border, padding: spacing.base, marginTop: -28, ...shadow.card },
  snapTrack: { height: 8, borderRadius: 8, backgroundColor: "rgba(10,37,64,0.08)", overflow: "hidden", marginTop: spacing.sm },
  snapFill: { height: "100%", borderRadius: 8, backgroundColor: GOLD },
  verseCard: { backgroundColor: "#FFF8E6", borderRadius: 22, borderWidth: 1, borderColor: "rgba(201,162,39,0.25)", padding: spacing.base },
  verseIcon: { width: 28, height: 28, borderRadius: 8, backgroundColor: "rgba(201,162,39,0.13)", alignItems: "center", justifyContent: "center" },
  disciplerCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: palette.white, borderRadius: 22, borderWidth: 1, borderColor: palette.border, padding: spacing.md },
  disciplerAvatar: { width: 44, height: 44, borderRadius: 16, backgroundColor: "#16A34A", alignItems: "center", justifyContent: "center" },
  chatBtn: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: NAVY, borderRadius: radii.pill, paddingHorizontal: 14, paddingVertical: 9 },
  listHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginTop: spacing.lg, marginBottom: spacing.base },
  countPill: { backgroundColor: palette.white, borderRadius: radii.pill, paddingHorizontal: 12, paddingVertical: 6, ...shadow.card },
  node: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  nodeNum: { position: "absolute", bottom: -2, right: -2, width: 16, height: 16, borderRadius: 8, backgroundColor: palette.white, borderWidth: 1, borderColor: palette.border, alignItems: "center", justifyContent: "center" },
  connector: { width: 3, flex: 1, borderRadius: 2, minHeight: 18, marginTop: 2 },
  station: { borderRadius: 20, borderWidth: 1, borderColor: palette.border, padding: spacing.base, ...shadow.card },
  statPill: { borderRadius: radii.pill, paddingHorizontal: 8, paddingVertical: 3, alignSelf: "flex-start" },
  miniTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: "rgba(10,37,64,0.08)", overflow: "hidden" },
  metaChip: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: palette.mutedBg, borderRadius: radii.pill, paddingHorizontal: 8, paddingVertical: 3 },
  resumePill: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: NAVY, borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 5 },
  encRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, borderRadius: 16, borderWidth: 1, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  encEmoji: { width: 44, height: 44, borderRadius: 16, backgroundColor: palette.white, borderWidth: 1, borderColor: "rgba(201,162,39,0.4)", alignItems: "center", justifyContent: "center" },
  splash: { overflow: "hidden", borderRadius: 22, padding: spacing.base, backgroundColor: NAVY },
  splashImg: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, width: "100%", height: "100%", opacity: 0.25 },
  splashShade: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(10,37,64,0.45)" },
  sticker: { width: 32, height: 32, borderRadius: 16, backgroundColor: palette.white, borderWidth: 1, borderColor: "rgba(201,162,39,0.33)", alignItems: "center", justifyContent: "center" },
  nextCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, borderRadius: 22, padding: spacing.base, marginTop: spacing.base },
  nextBadge: { width: 44, height: 44, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  finalRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, marginTop: spacing.lg },
  finalDash: { width: 28, height: 1, backgroundColor: palette.border },
  toast: { position: "absolute", bottom: 32, left: spacing.screen, right: spacing.screen, backgroundColor: palette.ink, borderRadius: radii.card, paddingHorizontal: spacing.base, paddingVertical: spacing.md },
  press: { transform: [{ scale: 0.99 }] },
} as const;
