// Quiz (spec §3.7; Figma "QuizScreen"). Questions are SERVER-ASSEMBLED (no answers
// leaked) and the attempt is SCORED SERVER-SIDE — the client never decides pass/fail
// (§1.1, §1.3). One question per screen, gold progress dots, large tap targets; a
// passing attempt invalidates the pathway/level caches so the next module unlocks.
import { useMemo, useState, type ReactElement } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";
import { ChevronLeft } from "lucide-react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { palette, radii, spacing, shadow } from "../theme/tokens";
import { PButton, T } from "../theme/components";
import { Loading, ErrorState } from "../components/states";
import { useQuiz, useModule } from "../api/hooks";
import { NuruApi } from "../api/client";
import type { QuizQuestion, QuizResult } from "../api/types";
import { errorMessage, invalidateQueries, useMutation } from "../api/query";
import { uuidv4 } from "../util/uuid";

const TF_OPTIONS = ["True", "False"];

export function QuizScreen(): ReactElement {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { moduleId } = useRoute<RouteProp<RootStackParamList, "Quiz">>().params;
  const { data: quiz, isLoading, error, refetch } = useQuiz(moduleId);
  const { data: module } = useModule(moduleId);
  const submit = useMutation((body: { client_mutation_id: string; answers: Array<{ question_id: string; given_answer: string }> }) =>
    NuruApi.submitQuiz(moduleId, body),
  );

  const [q, setQ] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<QuizResult | null>(null);
  const mutationId = useMemo(() => uuidv4(), [quiz]); // one idempotency key per assembled quiz

  const questions = quiz?.questions ?? [];
  const question = questions[q];
  const isLast = q === questions.length - 1;
  const given = question ? (answers[question.question_id] ?? "") : "";

  function setAnswer(value: string): void {
    if (question) setAnswers((a) => ({ ...a, [question.question_id]: value }));
  }

  async function next(): Promise<void> {
    if (!given.trim()) return;
    if (!isLast) {
      setQ((n) => n + 1);
      return;
    }
    const payload = {
      client_mutation_id: mutationId,
      answers: questions
        .map((qq) => ({ question_id: qq.question_id, given_answer: answers[qq.question_id] ?? "" }))
        .filter((a) => a.given_answer.trim().length > 0),
    };
    try {
      const r = await submit.mutate(payload);
      setResult(r);
      if (r.is_passed) {
        invalidateQueries("pathway");
        if (module) invalidateQueries(`levelModules:${module.level_number}`);
        invalidateQueries(`module:${moduleId}`);
        invalidateQueries("achievements");
      }
    } catch {
      // surfaced via submit.error
    }
  }

  function retry(): void {
    setResult(null);
    setAnswers({});
    setQ(0);
    void refetch();
  }

  // ---- Result (server-authoritative) ----
  if (result) {
    return result.is_passed ? (
      <View style={[res.root, { backgroundColor: "#081C36" }]}>
        <Header onBack={() => nav.goBack()} title="Module quiz" />
        <View style={res.center}>
          <View style={res.laurel}><T style={{ fontSize: 44 }}>🏅</T></View>
          <T style={res.bigGold}>{Math.round(result.score_achieved)}%</T>
          <T variant="title" tone="onNavy" style={{ marginTop: spacing.sm }}>Module passed</T>
          <T variant="body" tone="onNavyDim" style={{ marginTop: spacing.sm, textAlign: "center" }}>
            Passed at {result.pass_mark}%. Well done.
          </T>
          <View style={{ width: "100%", maxWidth: 320, marginTop: spacing.xl }}>
            <PButton
              variant="gold"
              onPress={() =>
                result.unlocked_next_module_id
                  ? nav.navigate("Module", { moduleId: result.unlocked_next_module_id })
                  : nav.navigate("Tabs", { screen: "Home" })
              }
            >
              {result.unlocked_next_module_id ? "Next module" : "Continue pathway"}
            </PButton>
          </View>
        </View>
      </View>
    ) : (
      <View style={[res.root, { backgroundColor: palette.paper }]}>
        <Header onBack={() => nav.goBack()} title="Module quiz" />
        <View style={res.center}>
          <View style={res.book}><T style={{ fontSize: 40 }}>📖</T></View>
          <T style={[res.bigGold, { color: palette.ink }]}>{Math.round(result.score_achieved)}%</T>
          <T variant="title" style={{ marginTop: spacing.xs }}>Almost there</T>
          <T variant="bodyLg" tone="secondary" style={{ marginTop: spacing.sm, textAlign: "center", maxWidth: 300 }}>
            You need {result.pass_mark}% to pass. Review the lesson — you've got this.
          </T>
          <View style={{ width: "100%", maxWidth: 320, marginTop: spacing.xl, gap: spacing.md }}>
            <PButton variant="primary" onPress={() => nav.navigate("Module", { moduleId })}>Review lesson</PButton>
            <PButton variant="ghost" onPress={retry}>Retry quiz</PButton>
          </View>
        </View>
      </View>
    );
  }

  // ---- Loading / error ----
  if (isLoading || !question) {
    return (
      <View style={{ flex: 1, backgroundColor: palette.paper }}>
        <Header onBack={() => nav.goBack()} title="Module quiz" />
        {error ? <ErrorState message={errorMessage(error)} onRetry={() => void refetch()} /> : <Loading label="Loading quiz…" />}
      </View>
    );
  }

  // ---- Quiz ----
  return (
    <View style={{ flex: 1, backgroundColor: palette.paper }}>
      <View style={{ backgroundColor: palette.navy, paddingTop: 52, paddingHorizontal: spacing.base, paddingBottom: spacing.lg }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => nav.goBack()} style={res.iconBtn}>
            <ChevronLeft size={20} color={palette.onNavy} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <T variant="micro" tone="onNavyDim" style={{ letterSpacing: 1.2 }}>MODULE QUIZ</T>
            <T variant="heading" tone="onNavy">{module?.title ?? "Quiz"}</T>
          </View>
        </View>
        <View style={res.dots}>
          {questions.map((_, i) => (
            <View key={i} style={[res.dot, { width: i === q ? 24 : 8, backgroundColor: i <= q ? palette.gold : "rgba(255,255,255,0.18)" }]} />
          ))}
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }} showsVerticalScrollIndicator={false}>
        <T variant="overline" tone="tertiary">QUESTION {q + 1} OF {questions.length}</T>
        <T variant="title" style={{ marginTop: spacing.md, marginBottom: spacing.lg }}>{question.question_text}</T>
        <QuestionInput question={question} value={given} onChange={setAnswer} />
        {submit.error ? (
          <T variant="caption" style={{ color: palette.error, marginTop: spacing.base }}>{errorMessage(submit.error)}</T>
        ) : null}
      </ScrollView>

      <View style={res.footer}>
        <PButton onPress={() => void next()} disabled={!given.trim() || submit.isLoading}>
          {submit.isLoading ? "Submitting…" : isLast ? "Submit answers" : "Next question"}
        </PButton>
      </View>
    </View>
  );
}

function QuestionInput({
  question,
  value,
  onChange,
}: {
  question: QuizQuestion;
  value: string;
  onChange: (v: string) => void;
}): ReactElement {
  if (question.q_type === "FillInTheBlank") {
    return (
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder="Type your answer…"
        placeholderTextColor={palette.ink400}
        style={fib.input}
        accessibilityLabel="Your answer"
      />
    );
  }
  const options = question.q_type === "TrueFalse" ? TF_OPTIONS : question.answer_options ?? [];
  return (
    <View style={{ gap: spacing.md }}>
      {options.map((opt) => {
        const sel = value === opt;
        return (
          <Pressable
            key={opt}
            accessibilityRole="radio"
            accessibilityState={{ selected: sel }}
            onPress={() => onChange(opt)}
            style={[opt2.wrap, sel ? opt2.selected : opt2.idle]}
          >
            <View style={[opt2.radio, { borderColor: sel ? palette.navy : "#D8DAE0", backgroundColor: sel ? palette.navy : "transparent" }]}>
              {sel ? <View style={opt2.radioDot} /> : null}
            </View>
            <T variant="bodyLg" style={{ flex: 1, fontWeight: sel ? "500" : "400" }}>{opt}</T>
          </Pressable>
        );
      })}
    </View>
  );
}

function Header({ onBack, title }: { onBack: () => void; title: string }): ReactElement {
  return (
    <View style={res.header}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onBack} style={res.iconBtn}>
        <ChevronLeft size={20} color={palette.onNavy} />
      </Pressable>
      <T variant="heading" tone="onNavy">{title}</T>
    </View>
  );
}

const res = {
  root: { flex: 1 },
  header: { backgroundColor: palette.navy, paddingTop: 52, paddingHorizontal: spacing.base, paddingBottom: spacing.base, flexDirection: "row", alignItems: "center", gap: spacing.md },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.xl },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.10)", alignItems: "center", justifyContent: "center" },
  dots: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, marginTop: spacing.base },
  dot: { height: 7, borderRadius: 4 },
  laurel: { width: 120, height: 120, borderRadius: 60, borderWidth: 2, borderColor: "rgba(201,162,39,0.45)", backgroundColor: "rgba(201,162,39,0.09)", alignItems: "center", justifyContent: "center", marginBottom: spacing.xl },
  book: { width: 100, height: 100, borderRadius: 50, backgroundColor: "rgba(10,37,64,0.07)", alignItems: "center", justifyContent: "center", marginBottom: spacing.lg },
  bigGold: { fontSize: 52, fontWeight: "800", letterSpacing: -2, color: palette.gold, lineHeight: 56 },
  footer: { borderTopWidth: 1, borderTopColor: palette.border, backgroundColor: palette.white, paddingHorizontal: spacing.lg, paddingTop: spacing.base, paddingBottom: spacing.lg },
} as const;

const opt2 = {
  wrap: { flexDirection: "row", alignItems: "center", gap: spacing.base, borderRadius: radii.control, padding: spacing.base, minHeight: 56, borderWidth: 1.5 },
  idle: { backgroundColor: palette.white, borderColor: "rgba(0,0,0,0.08)" },
  selected: { backgroundColor: "rgba(10,37,64,0.06)", borderColor: palette.navy, ...shadow.card },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  radioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: palette.white },
} as const;

const fib = {
  input: {
    borderRadius: radii.control,
    borderWidth: 1.5,
    borderColor: "rgba(0,0,0,0.08)",
    backgroundColor: palette.white,
    padding: spacing.base,
    minHeight: 56,
    fontSize: 16,
    color: palette.ink,
  },
} as const;
