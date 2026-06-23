// Spiritual gifts (new design, Contract Matrix M3 over B6). With a profile:
// "Your top gifts" + where-to-serve tracks, and a retake path. Without one:
// the Likert assessment (1 Rarely … 5 Strongly agree) — scored SERVER-side
// over the full bank; the client never computes its own gift profile (§1.1).
import { useState, type ReactElement } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { ArrowLeft } from "lucide-react-native";
import { useNavigation } from "@react-navigation/native";
import { NuruApi } from "../api/client";
import { uuidv4 } from "../util/uuid";
import { palette, radii, spacing, shadow } from "../theme/tokens";
import { PButton, ProgressBar, T } from "../theme/components";
import { useGiftQuestions, useMyGifts } from "../api/hooks";
import { errorMessage, invalidateQueries } from "../api/query";
import { writeThrough } from "../sync/offlineWrite";
import { getSyncEngine } from "../sync/engineProvider";
import { getConnectivity } from "../net/connectivity";
import { Loading, ErrorState } from "../components/states";

const LIKERT = [
  { value: 1, label: "Rarely" },
  { value: 2, label: "Sometimes" },
  { value: 3, label: "Often" },
  { value: 4, label: "Agree" },
  { value: 5, label: "Strongly agree" },
] as const;

const GIFT_NAMES: Record<string, string> = {
  leadership: "Leadership",
  teaching: "Teaching",
  service: "Service",
  mercy: "Mercy",
  evangelism: "Evangelism",
  giving: "Giving",
  hospitality: "Hospitality",
};

export function GiftsScreen(): ReactElement {
  const nav = useNavigation();
  const { data: gifts, isLoading, error, refetch } = useMyGifts();
  const [retaking, setRetaking] = useState(false);

  return (
    <View style={st.screen}>
      <View style={st.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => nav.goBack()}
          style={({ pressed }) => [st.iconBtn, pressed && { transform: [{ scale: 0.95 }] }]}
        >
          <ArrowLeft size={20} color={palette.onNavy} />
        </Pressable>
        <T variant="heading" tone="onNavy">Spiritual gifts</T>
      </View>

      {isLoading ? (
        <View style={st.center}>
          <Loading label="Loading…" />
        </View>
      ) : error ? (
        <View style={st.center}>
          <ErrorState message={errorMessage(error)} onRetry={() => void refetch()} />
        </View>
      ) : gifts?.assessment && !retaking ? (
        <Results gifts={gifts} onRetake={() => setRetaking(true)} />
      ) : (
        <Assessment
          onDone={() => {
            setRetaking(false);
            invalidateQueries("myGifts");
            void refetch();
          }}
        />
      )}
    </View>
  );
}

function Results({ gifts, onRetake }: { gifts: NonNullable<ReturnType<typeof useMyGifts>["data"]>; onRetake: () => void }): ReactElement {
  const a = gifts.assessment;
  if (!a) return <View />;
  const top = a.top_gifts;
  const personaByKey = new Map(gifts.personas.map((p) => [p.gift_key, p]));
  const label = (g: string): string => personaByKey.get(g)?.title ?? GIFT_NAMES[g] ?? g;
  const lead = gifts.personas[0];
  return (
    <ScrollView contentContainerStyle={{ padding: spacing.screen, paddingBottom: spacing.xxl, gap: spacing.base }} showsVerticalScrollIndicator={false}>
      {/* Personality headline */}
      <View style={st.personaHero}>
        <T variant="micro" tone="gold" style={{ letterSpacing: 1.6, fontWeight: "800" }}>YOUR GIFT PERSONALITY</T>
        {lead ? (
          <T serif tone="onNavy" style={{ fontSize: 24, lineHeight: 29, marginTop: 4 }}>
            {`${lead.emoji ?? "✨"}  ${lead.persona_name}`}
          </T>
        ) : null}
        {a.persona_summary ? (
          <T variant="body" tone="onNavyDim" style={{ marginTop: spacing.sm, lineHeight: 22 }}>{a.persona_summary}</T>
        ) : null}
      </View>

      {/* Persona cards for each top gift */}
      <T variant="overline" tone="secondary">YOUR TOP GIFTS</T>
      {top.map((g, i) => {
        const p = personaByKey.get(g);
        const accent = p?.color ?? palette.gold;
        return (
          <View key={g} style={[st.giftCard, { borderColor: `${accent}55` }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
              <View style={[st.rank, { backgroundColor: accent }]}>
                <T variant="heading" style={{ color: "#fff" }}>{p?.emoji ?? `${i + 1}`}</T>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <T variant="heading">{p?.persona_name ?? label(g)}</T>
                <T variant="micro" tone="tertiary">{label(g)}</T>
              </View>
              <T variant="heading" style={{ fontSize: 15, color: accent }}>{`${a.scores[g] ?? 0}%`}</T>
            </View>
            <View style={{ marginTop: spacing.sm }}>
              <ProgressBar pct={a.scores[g] ?? 0} />
            </View>
            {p?.summary ? <T variant="caption" tone="secondary" style={{ marginTop: spacing.sm, lineHeight: 20 }}>{p.summary}</T> : null}
            {p && p.strengths.length > 0 ? (
              <View style={st.chipWrap}>
                {p.strengths.slice(0, 4).map((s) => (
                  <View key={s} style={st.strengthChip}><T variant="micro" style={{ color: palette.ink600, fontWeight: "600" }}>{s}</T></View>
                ))}
              </View>
            ) : null}
          </View>
        );
      })}

      <T variant="overline" tone="secondary" style={{ marginTop: spacing.sm }}>WHERE TO SERVE</T>
      {gifts.suggested_tracks.map((t) => (
        <View key={t.track_key} style={st.trackCard}>
          <T variant="heading">{t.title}</T>
          <T variant="caption" tone="secondary" style={{ marginTop: 4 }}>{t.description}</T>
        </View>
      ))}
      {gifts.suggested_tracks.length === 0 ? (
        <T variant="caption" tone="secondary">Talk to your leader about where these gifts fit best.</T>
      ) : null}

      <View style={{ marginTop: spacing.sm }}>
        <PButton variant="ghost" onPress={onRetake}>Retake the assessment</PButton>
      </View>
    </ScrollView>
  );
}

function Assessment({ onDone }: { onDone: () => void }): ReactElement {
  const { data: set, isLoading, error, refetch } = useGiftQuestions();
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  if (isLoading) {
    return (
      <View style={st.center}>
        <Loading label="Tailoring your questions…" />
      </View>
    );
  }
  if (error || !set) {
    return (
      <View style={st.center}>
        <ErrorState message={errorMessage(error)} onRetry={() => void refetch()} />
      </View>
    );
  }

  const questions = set.data;
  const answered = Object.keys(answers).length;
  const complete = answered === questions.length;

  async function submit(): Promise<void> {
    if (!set) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const payload = {
        client_mutation_id: uuidv4(),
        set_id: set.set_id,
        answers: Object.entries(answers).map(([question_id, value]) => ({ question_id, value })),
      };
      await writeThrough({
        engine: getSyncEngine(),
        connectivity: getConnectivity(),
        online: () => NuruApi.submitGifts(payload),
        queued: { domain: "gift_assessments", op: "submit", payload },
      });
      onDone();
    } catch (e) {
      setSubmitError(errorMessage(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.screen, paddingBottom: spacing.xxl }} showsVerticalScrollIndicator={false}>
      <T serif style={{ fontSize: 20, color: palette.ink }}>Discover your gifts</T>
      <T variant="caption" tone="secondary" style={{ marginTop: 2 }}>
        {set.ai_influenced ? "These questions are chosen for you by Nuru, from your journey so far." : "A fresh set of questions, shuffled just for you."}
      </T>
      <View style={{ marginTop: spacing.base }}>
        <T variant="caption" tone="secondary">{`${answered} of ${questions.length} answered`}</T>
        <View style={{ marginTop: spacing.sm, marginBottom: spacing.base }}>
          <ProgressBar pct={questions.length > 0 ? (answered / questions.length) * 100 : 0} />
        </View>
      </View>

      {questions.map((q) => (
        <View key={q.question_id} style={st.questionCard}>
          <T variant="body" style={{ color: palette.ink }}>{q.prompt}</T>
          <View style={st.likertRow}>
            {LIKERT.map((opt) => {
              const on = answers[q.question_id] === opt.value;
              return (
                <Pressable
                  key={opt.value}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={opt.label}
                  onPress={() => setAnswers((prev) => ({ ...prev, [q.question_id]: opt.value }))}
                  style={[st.likert, on && { backgroundColor: palette.navy }]}
                >
                  <T variant="micro" style={{ color: on ? palette.gold : palette.ink600 }}>{opt.value}</T>
                </Pressable>
              );
            })}
          </View>
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 4 }}>
            <T variant="micro" tone="tertiary">Rarely</T>
            <T variant="micro" tone="tertiary">Strongly agree</T>
          </View>
        </View>
      ))}

      {submitError ? <T variant="caption" style={{ color: palette.error, marginBottom: spacing.sm }}>{submitError}</T> : null}
      <PButton variant="gold" onPress={() => void submit()} disabled={!complete || submitting}>
        {submitting ? "Scoring…" : complete ? "See my gifts" : `Answer ${questions.length - answered} more`}
      </PButton>
    </ScrollView>
  );
}

const st = {
  screen: { flex: 1, backgroundColor: palette.coolPaper },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: palette.navy,
    paddingTop: 54,
    paddingBottom: spacing.base,
    paddingHorizontal: spacing.lg,
  },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.10)", alignItems: "center", justifyContent: "center" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  giftCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: palette.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(201,162,39,0.25)",
    padding: spacing.base,
    ...shadow.card,
  },
  rank: { width: 40, height: 40, borderRadius: 13, backgroundColor: palette.navy, alignItems: "center", justifyContent: "center" },
  personaHero: { backgroundColor: palette.navyDeep, borderRadius: radii.card, padding: spacing.lg, borderWidth: 1, borderColor: "rgba(201,162,39,0.33)", ...shadow.card },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: spacing.md },
  strengthChip: { backgroundColor: palette.surface, borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: palette.border },
  trackCard: {
    backgroundColor: palette.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: palette.border,
    padding: spacing.base,
    ...shadow.card,
  },
  questionCard: {
    backgroundColor: palette.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: palette.border,
    padding: spacing.base,
    marginBottom: spacing.md,
  },
  likertRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  likert: {
    flex: 1,
    height: 40,
    borderRadius: radii.control,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.coolPaper,
    alignItems: "center",
    justifyContent: "center",
  },
} as const;
