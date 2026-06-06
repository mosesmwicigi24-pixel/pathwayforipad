// Level (Figma "PathwayTab", pushed from Levels/Home). The per-level module feed:
// a navy hero with the level summary + progress, then sequential module cards
// (completed / next / locked). Tapping a locked module shows a gentle toast rather
// than a hard error — the server stays authoritative for what actually unlocks
// (§1.9). Renders instantly from local content; a background sync reconciles.
import { useState, type ReactElement } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { ArrowLeft, Check, Clock, FileText, Lock, PlayCircle } from "lucide-react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { palette, radii, spacing, shadow } from "../theme/tokens";
import { Glow, T } from "../theme/components";
import { useLevelModules, usePathway } from "../api/hooks";
import { errorMessage } from "../api/query";
import { Loading, ErrorState, Empty } from "../components/states";
import type { LevelModule } from "../api/types";

export function LevelScreen(): ReactElement {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { levelId } = useRoute<RouteProp<RootStackParamList, "Level">>().params;
  const { data: modules, isLoading, error, refetch } = useLevelModules(levelId);
  const { data: pathway } = usePathway();
  const [toast, setToast] = useState<string | null>(null);

  const meta = pathway?.levels.find((l) => l.level_number === levelId);
  const completed = modules?.filter((m) => m.completed).length ?? meta?.completed_modules ?? 0;
  const total = modules?.length ?? meta?.total_modules ?? 0;
  const minutes = modules?.reduce((s, m) => s + (m.estimated_minutes ?? 0), 0) ?? meta?.minutes ?? 0;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  const tapModule = (mod: LevelModule, index: number): void => {
    if (mod.locked) {
      const prev = modules?.[index - 1];
      setToast(`Complete “${prev?.title ?? "the previous module"}” first`);
      setTimeout(() => setToast(null), 2600);
      return;
    }
    nav.navigate("Module", { moduleId: mod.module_id });
  };

  return (
    <View style={st.screen}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing.xxl }}>
        {/* Navy hero */}
        <View style={st.header}>
          <Glow size={220} color="rgba(201,162,39,0.10)" style={{ right: -60, top: -60 }} />
          <View style={st.headRow}>
            <Pressable onPress={() => nav.goBack()} style={({ pressed }) => [st.iconBtn, pressed && st.press]} accessibilityRole="button" accessibilityLabel="Back">
              <ArrowLeft size={20} color={palette.onNavy} />
            </Pressable>
          </View>

          <View style={st.heroCard}>
            <T variant="overline" tone="gold">{`LEVEL ${levelId}`}</T>
            <T variant="display" tone="onNavy" style={{ marginTop: spacing.sm }}>{meta?.title ?? `Level ${levelId}`}</T>
            {meta?.theme ? <T variant="body" tone="onNavyDim" style={{ marginTop: spacing.sm }}>{meta.theme}</T> : null}
            <View style={st.heroProgressRow}>
              <View style={{ flex: 1 }}>
                <View style={st.heroLabels}>
                  <T variant="caption" tone="onNavyDim">{`${completed} of ${total} modules`}</T>
                  <T variant="caption" tone="onNavyDim">{`${pct}%`}</T>
                </View>
                <View style={st.heroTrack}>
                  <View style={[st.heroFill, { width: `${pct}%` }]} />
                </View>
              </View>
              <View style={st.minutes}>
                <T variant="caption" tone="gold">{`≈ ${minutes} min`}</T>
              </View>
            </View>
          </View>
        </View>

        {/* Module list */}
        <View style={{ paddingHorizontal: spacing.screen, paddingTop: spacing.lg }}>
          <View style={st.listHead}>
            <View>
              <T variant="overline" tone="secondary">COURSE MODULES</T>
              <T variant="title" style={{ marginTop: 2 }}>Learn step by step</T>
            </View>
            <View style={st.countPill}>
              <T variant="caption" tone="secondary">{`${total} lessons`}</T>
            </View>
          </View>

          {isLoading ? (
            <Loading label="Loading modules…" />
          ) : error ? (
            <ErrorState message={errorMessage(error)} onRetry={() => void refetch()} />
          ) : !modules || modules.length === 0 ? (
            <Empty title="No published lessons yet" subtitle="Check back soon — content is being prepared for this level." />
          ) : (
            <View style={{ gap: spacing.md }}>
              {modules.map((m, i) => (
                <ModuleCard key={m.module_id} module={m} onTap={() => tapModule(m, i)} />
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      {toast ? (
        <View style={st.toast}>
          <T variant="body" tone="onNavy" style={{ textAlign: "center" }}>{toast}</T>
        </View>
      ) : null}
    </View>
  );
}

function ModuleCard({ module, onTap }: { module: LevelModule; onTap: () => void }): ReactElement {
  const locked = module.locked;
  const completed = module.completed;
  const next = !completed && !locked;
  const iconBg = completed ? palette.goldTint : next ? palette.navy : palette.mutedBg;
  const iconFg = completed ? palette.goldLo : next ? palette.gold : palette.ink400;
  const fill = completed ? palette.gold : next ? palette.navy : palette.lockedFill;
  const minutes = module.estimated_minutes ?? 0;

  return (
    <Pressable
      onPress={onTap}
      style={({ pressed }) => [st.card, next && { borderColor: "rgba(201,162,39,0.5)" }, locked && { opacity: 0.55 }, pressed && !locked && st.press]}
      accessibilityRole="button"
      accessibilityLabel={`Module ${module.module_sequence_number}: ${module.title}${locked ? ", locked" : ""}`}
    >
      <View style={[st.cardIcon, { backgroundColor: iconBg }]}>
        {completed ? <Check size={20} color={iconFg} /> : locked ? <Lock size={18} color={iconFg} /> : <PlayCircle size={21} color={iconFg} />}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={st.cardMetaRow}>
          <T variant="caption" tone="secondary">{`Module ${module.module_sequence_number}`}</T>
          <View style={st.minRow}>
            <Clock size={12} color={palette.ink600} />
            <T variant="caption" tone="secondary">{`${minutes} min`}</T>
          </View>
        </View>
        <T variant="heading" style={{ marginTop: 2 }}>{module.title}</T>
        {module.summary ? <T variant="body" tone="secondary" style={{ marginTop: 2 }}>{module.summary}</T> : null}
        <View style={{ marginTop: spacing.md }}>
          <View style={st.progRow}>
            <T variant="micro" tone="tertiary">Progress</T>
            <T variant="micro" tone="secondary">{`${module.progress}%`}</T>
          </View>
          <View style={st.track}>
            <View style={[st.fill, { width: `${module.progress}%`, backgroundColor: fill }]} />
          </View>
        </View>
        <View style={st.mediaRow}>
          <T variant="micro" tone="tertiary">{completed ? "Completed" : locked ? "Locked" : "Tap to begin"}</T>
          <View style={st.mediaIcons}>
            <View style={st.mediaIcon}>
              <FileText size={13} color="#506076" />
            </View>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

const st = {
  screen: { flex: 1, backgroundColor: palette.paper },
  header: { backgroundColor: palette.navy, paddingHorizontal: spacing.screen, paddingTop: 52, paddingBottom: spacing.lg, overflow: "hidden" },
  headRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.base },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.10)", alignItems: "center", justifyContent: "center" },
  syncPill: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(255,255,255,0.08)", borderRadius: radii.pill, paddingHorizontal: 12, paddingVertical: 6 },
  heroCard: { borderRadius: radii.hero, borderWidth: 1, borderColor: "rgba(255,255,255,0.10)", backgroundColor: "rgba(255,255,255,0.06)", padding: spacing.lg },
  heroProgressRow: { flexDirection: "row", alignItems: "center", gap: spacing.base, marginTop: spacing.lg },
  heroLabels: { flexDirection: "row", justifyContent: "space-between", marginBottom: spacing.sm },
  heroTrack: { height: 8, borderRadius: 8, backgroundColor: "rgba(255,255,255,0.10)", overflow: "hidden" },
  heroFill: { height: "100%", borderRadius: 8, backgroundColor: palette.gold },
  minutes: { backgroundColor: "rgba(201,162,39,0.15)", borderRadius: radii.control, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  listHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginBottom: spacing.base },
  countPill: { backgroundColor: palette.white, borderRadius: radii.pill, paddingHorizontal: 12, paddingVertical: 6, ...shadow.card },
  card: { flexDirection: "row", gap: spacing.base, backgroundColor: palette.white, borderRadius: radii.card, borderWidth: 1, borderColor: palette.border, padding: spacing.base, ...shadow.card },
  cardIcon: { width: 48, height: 48, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  cardMetaRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  minRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  progRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  track: { height: 6, borderRadius: 6, backgroundColor: palette.track, overflow: "hidden" },
  fill: { height: "100%", borderRadius: 6 },
  mediaRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: spacing.md },
  mediaIcons: { flexDirection: "row", gap: 6 },
  mediaIcon: { width: 28, height: 28, borderRadius: 14, backgroundColor: "rgba(10,37,64,0.06)", alignItems: "center", justifyContent: "center" },
  toast: { position: "absolute", bottom: 32, left: spacing.screen, right: spacing.screen, backgroundColor: palette.ink, borderRadius: radii.card, paddingHorizontal: spacing.base, paddingVertical: spacing.md },
  press: { transform: [{ scale: 0.99 }] },
} as const;
