// Quiz (spec §3.7; Figma "QuizScreen"). Questions are SERVER-ASSEMBLED (no answers
// leaked) and the attempt is SCORED SERVER-SIDE — the client never decides pass/fail
// (§1.1, §1.3). One question per screen, gold progress dots, large tap targets; a
// passing attempt invalidates the pathway/level caches so the next module unlocks.
import { useMemo, useState, type ReactElement } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";
import { ChevronLeft, Check } from "lucide-react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { palette, radii, spacing, shadow } from "../theme/tokens";
import { PButton, T } from "../theme/components";
import { Loading, ErrorState } from "../components/states";
import { useKeyboardInset } from "../components/useKeyboardInset";
import { useQuiz, useModule } from "../api/hooks";
import { NuruApi } from "../api/client";
import type { AnswerOptions, QuestionChoice, QuestionScale, QuizQuestion, QuizResult } from "../api/types";
import { errorMessage, invalidateQueries, useMutation } from "../api/query";
import { uuidv4 } from "../util/uuid";

const TF_OPTIONS: QuestionChoice[] = [
  { id: "True", text: "True" },
  { id: "False", text: "False" },
];

// ---- answer_options decoding (polymorphic; answer signal already stripped, §5.8) ----
// Normalize whatever the backend sends into the inputs each renderer needs.
function decodeChoices(opts: AnswerOptions): QuestionChoice[] {
  if (Array.isArray(opts)) return opts.map((s) => ({ id: String(s), text: String(s) }));
  if (opts && typeof opts === "object" && "choices" in opts && Array.isArray(opts.choices)) {
    return opts.choices.map((c) => ({ id: String(c.id), text: String(c.text) }));
  }
  return [];
}
function decodeScale(opts: AnswerOptions): QuestionScale {
  if (opts && typeof opts === "object" && "scale" in opts && opts.scale) {
    return opts.scale;
  }
  return { min: 1, max: 5 };
}

// Which renderer a question maps to (collapses legacy kinds onto the new ones).
type Kind = "single" | "checkbox" | "short" | "paragraph" | "scale";
function kindOf(qType: QuizQuestion["q_type"]): Kind {
  switch (qType) {
    case "checkbox":
      return "checkbox";
    case "short_answer":
      return "short";
    case "paragraph":
      return "paragraph";
    case "linear_scale":
      return "scale";
    // multiple_choice / dropdown / legacy MultipleChoice / TrueFalse / FillInTheBlank
    default:
      return "single";
  }
}

// checkbox answers are carried as a JSON array of selected ids in the string slot.
function parseChecked(value: string): string[] {
  if (!value.trim()) return [];
  try {
    const v = JSON.parse(value);
    return Array.isArray(v) ? v.map((x) => String(x)) : [];
  } catch {
    return [value];
  }
}

// Has the learner supplied an answer? (Required-gating per type.)
function isAnswered(question: QuizQuestion, value: string): boolean {
  if (kindOf(question.q_type) === "checkbox") return parseChecked(value).length > 0;
  return value.trim().length > 0;
}

export function QuizScreen(): ReactElement {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { moduleId } = useRoute<RouteProp<RootStackParamList, "Quiz">>().params;
  const { data: quiz, isLoading, error, refetch } = useQuiz(moduleId);
  const { data: module } = useModule(moduleId);
  const submit = useMutation((body: { client_mutation_id: string; answers: Array<{ question_id: string; given_answer: string }> }) =>
    NuruApi.submitQuiz(moduleId, body),
  );

  const [q, setQ] = useState(0);
  const kbInset = useKeyboardInset();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<QuizResult | null>(null);
  const mutationId = useMemo(() => uuidv4(), [quiz]); // one idempotency key per assembled quiz

  const questions = quiz?.questions ?? [];
  const question = questions[q];
  const isLast = q === questions.length - 1;
  const given = question ? (answers[question.question_id] ?? "") : "";
  const answered = question ? isAnswered(question, given) : false;

  function setAnswer(value: string): void {
    if (question) setAnswers((a) => ({ ...a, [question.question_id]: value }));
  }

  async function next(): Promise<void> {
    if (!answered) return;
    if (!isLast) {
      setQ((n) => n + 1);
      return;
    }
    // Wire shape is { question_id, given_answer:string } per type:
    //   single-select → the chosen id; checkbox → JSON array of ids;
    //   short/paragraph → free text; linear_scale → the number as a string.
    const payload = {
      client_mutation_id: mutationId,
      answers: questions
        .map((qq) => ({ question_id: qq.question_id, given_answer: answers[qq.question_id] ?? "" }))
        .filter((a) => {
          const qq = questions.find((x) => x.question_id === a.question_id);
          return qq ? isAnswered(qq, a.given_answer) : false;
        }),
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
    // Written answers (paragraph / keyless short_answer) need a human. Surface
    // "pending review" rather than a fail, even if the auto-score didn't pass.
    if (result.requires_manual_review && !result.is_passed) {
      return (
        <View style={[res.root, { backgroundColor: palette.paper }]}>
          <Header onBack={() => nav.goBack()} title="Module quiz" />
          <View style={res.center}>
            <View style={res.book}><T style={{ fontSize: 40 }}>📝</T></View>
            <T serif variant="title" style={{ marginTop: spacing.xs, textAlign: "center" }}>Submitted for review</T>
            <T variant="bodyLg" tone="secondary" style={{ marginTop: spacing.sm, textAlign: "center", maxWidth: 320 }}>
              Your written answers are pending review by your leader. You'll be notified once they're marked.
            </T>
            <View style={{ width: "100%", maxWidth: 320, marginTop: spacing.xl, gap: spacing.md }}>
              <PButton variant="primary" onPress={() => nav.navigate("Module", { moduleId })}>Back to lesson</PButton>
              <PButton variant="ghost" onPress={() => nav.navigate("Tabs", { screen: "Home" })}>Continue pathway</PButton>
            </View>
          </View>
        </View>
      );
    }
    return result.is_passed ? (
      <View style={[res.root, { backgroundColor: "#081C36" }]}>
        <Header onBack={() => nav.goBack()} title="Module quiz" />
        <View style={res.center}>
          <View style={res.laurel}><T style={{ fontSize: 44 }}>🏅</T></View>
          <T serif style={res.bigGold}>{Math.round(result.score_achieved)}%</T>
          <T serif variant="title" tone="onNavy" style={{ marginTop: spacing.sm }}>Module passed</T>
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
          <T serif style={[res.bigGold, { color: palette.ink }]}>{Math.round(result.score_achieved)}%</T>
          <T serif variant="title" style={{ marginTop: spacing.xs }}>Almost there</T>
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

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 + kbInset }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <T variant="overline" tone="tertiary">QUESTION {q + 1} OF {questions.length}</T>
        <T variant="title" style={{ marginTop: spacing.md, marginBottom: spacing.lg }}>{question.question_text}</T>
        <QuestionInput question={question} value={given} onChange={setAnswer} />
        {submit.error ? (
          <T variant="caption" style={{ color: palette.error, marginTop: spacing.base }}>{errorMessage(submit.error)}</T>
        ) : null}
      </ScrollView>

      <View style={[res.footer, { marginBottom: kbInset }]}>
        <PButton onPress={() => void next()} disabled={!answered || submit.isLoading}>
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
  const kind = kindOf(question.q_type);

  // short_answer → single line; paragraph → multiline (manually reviewed).
  if (kind === "short" || kind === "paragraph") {
    const multiline = kind === "paragraph";
    return (
      <View>
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder={multiline ? "Write your response…" : "Type your answer…"}
          placeholderTextColor={palette.ink400}
          style={[fib.input, multiline ? fib.multiline : null]}
          multiline={multiline}
          textAlignVertical={multiline ? "top" : "center"}
          accessibilityLabel="Your answer"
        />
        {multiline ? (
          <T variant="caption" tone="tertiary" style={{ marginTop: spacing.sm }}>
            This written answer is reviewed manually by your leader.
          </T>
        ) : null}
      </View>
    );
  }

  // linear_scale → a row of selectable numbers min..max with end labels.
  if (kind === "scale") {
    const scale = decodeScale(question.answer_options);
    const lo = Math.min(scale.min, scale.max);
    const hi = Math.max(scale.min, scale.max);
    const nums: number[] = [];
    for (let n = lo; n <= hi; n++) nums.push(n);
    return (
      <View style={{ gap: spacing.md }}>
        <View style={scaleS.row}>
          {nums.map((n) => {
            const sel = value === String(n);
            return (
              <Pressable
                key={n}
                accessibilityRole="radio"
                accessibilityState={{ selected: sel }}
                accessibilityLabel={String(n)}
                onPress={() => onChange(String(n))}
                style={[scaleS.cell, sel ? scaleS.cellSel : scaleS.cellIdle]}
              >
                <T variant="bodyLg" style={{ fontWeight: sel ? "700" : "500", color: sel ? palette.white : palette.ink }}>
                  {n}
                </T>
              </Pressable>
            );
          })}
        </View>
        {scale.min_label || scale.max_label ? (
          <View style={scaleS.labels}>
            <T variant="caption" tone="tertiary">{scale.min_label ?? ""}</T>
            <T variant="caption" tone="tertiary">{scale.max_label ?? ""}</T>
          </View>
        ) : null}
      </View>
    );
  }

  // checkbox → multi-select; selected ids carried as a JSON array string.
  if (kind === "checkbox") {
    const choices = decodeChoices(question.answer_options);
    const checked = parseChecked(value);
    function toggle(id: string): void {
      const next = checked.includes(id) ? checked.filter((c) => c !== id) : [...checked, id];
      onChange(next.length > 0 ? JSON.stringify(next) : "");
    }
    return (
      <View style={{ gap: spacing.md }}>
        {choices.map((c) => {
          const sel = checked.includes(c.id);
          return (
            <Pressable
              key={c.id}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: sel }}
              onPress={() => toggle(c.id)}
              style={[opt2.wrap, sel ? opt2.selected : opt2.idle]}
            >
              <View style={[opt2.box, { borderColor: sel ? palette.navy : "#D8DAE0", backgroundColor: sel ? palette.navy : "transparent" }]}>
                {sel ? <Check size={14} color={palette.white} strokeWidth={3} /> : null}
              </View>
              <T variant="bodyLg" style={{ flex: 1, fontWeight: sel ? "500" : "400" }}>{c.text}</T>
            </Pressable>
          );
        })}
      </View>
    );
  }

  // single-select (multiple_choice / dropdown / legacy MCQ/TrueFalse/FillInTheBlank).
  // The submitted value is the choice id (== text for legacy string options).
  const choices = question.q_type === "TrueFalse" ? TF_OPTIONS : decodeChoices(question.answer_options);
  return (
    <View style={{ gap: spacing.md }}>
      {choices.map((c) => {
        const sel = value === c.id;
        return (
          <Pressable
            key={c.id}
            accessibilityRole="radio"
            accessibilityState={{ selected: sel }}
            onPress={() => onChange(c.id)}
            style={[opt2.wrap, sel ? opt2.selected : opt2.idle]}
          >
            <View style={[opt2.radio, { borderColor: sel ? palette.navy : "#D8DAE0", backgroundColor: sel ? palette.navy : "transparent" }]}>
              {sel ? <View style={opt2.radioDot} /> : null}
            </View>
            <T variant="bodyLg" style={{ flex: 1, fontWeight: sel ? "500" : "400" }}>{c.text}</T>
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
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, alignItems: "center", justifyContent: "center" },
} as const;

const scaleS = {
  row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  cell: { minWidth: 48, height: 48, borderRadius: radii.control, borderWidth: 1.5, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.sm },
  cellIdle: { backgroundColor: palette.white, borderColor: "rgba(0,0,0,0.08)" },
  cellSel: { backgroundColor: palette.navy, borderColor: palette.navy, ...shadow.card },
  labels: { flexDirection: "row", justifyContent: "space-between" },
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
  multiline: { minHeight: 140 },
} as const;
