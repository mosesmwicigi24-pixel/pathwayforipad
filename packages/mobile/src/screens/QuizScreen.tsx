// Quiz (spec §3.7; Figma "QuizScreen"). One question per screen, gold progress
// dots, large tap targets. The attempt is queued offline and scored SERVER-SIDE —
// the client never decides pass/fail (§1.3); the result shown here is a local
// preview, confirmed on sync.
import { useState, type ReactElement } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useNavigation } from "../navigation/RootNavigator";
import { palette, radii, spacing, shadow } from "../theme/tokens";
import { PButton, T } from "../theme/components";

const QUESTIONS = [
  { text: "According to Scripture, what is the Church most accurately described as?", options: ["A building where believers meet", "The living body of Christ", "An organisation led by leaders", "A tradition from early Christians"], correct: 1 },
  { text: "Which Scripture calls the Church a royal priesthood?", options: ["Matthew 16:18", "1 Corinthians 12:27", "1 Peter 2:9", "Revelation 21:2"], correct: 2 },
  { text: "What did the earliest believers devote themselves to?", options: ["Fasting, giving, prayer, evangelism", "Teaching, fellowship, breaking bread, prayer", "Worship, baptism, healing, prophecy", "Scripture, community, service, mission"], correct: 1 },
];
const PASS = 70;

export function QuizScreen({ moduleId }: { moduleId: string }): ReactElement {
  const nav = useNavigation();
  const [q, setQ] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [answers, setAnswers] = useState<(number | null)[]>(Array(QUESTIONS.length).fill(null));
  const [phase, setPhase] = useState<"quiz" | "result">("quiz");
  const [score, setScore] = useState(0);

  const question = QUESTIONS[q]!;
  const isLast = q === QUESTIONS.length - 1;
  const passed = score >= PASS;

  function next(): void {
    if (selected === null) return;
    const a = [...answers];
    a[q] = selected;
    setAnswers(a);
    if (isLast) {
      // engine.enqueue("quiz_attempts", "submit", { module_id: moduleId, answers })
      const correct = a.filter((v, i) => v === QUESTIONS[i]!.correct).length;
      setScore(Math.round((correct / QUESTIONS.length) * 100));
      setPhase("result");
    } else {
      setQ((n) => n + 1);
      setSelected(null);
    }
  }

  function retry(): void {
    setQ(0);
    setSelected(null);
    setAnswers(Array(QUESTIONS.length).fill(null));
    setScore(0);
    setPhase("quiz");
  }

  if (phase === "result" && passed) {
    return (
      <View style={[res.root, { backgroundColor: "#081C36" }]}>
        <Header onBack={() => nav.goBack()} title="Module quiz" />
        <View style={res.center}>
          <View style={res.laurel}><T style={{ fontSize: 44 }}>🏅</T></View>
          <T style={res.bigGold}>{score}%</T>
          <T variant="title" tone="onNavy" style={{ marginTop: spacing.sm }}>Module passed</T>
          <T variant="body" tone="onNavyDim" style={{ marginTop: spacing.sm, textAlign: "center" }}>
            Excellent work. Final result is confirmed on sync.
          </T>
          <View style={{ width: "100%", maxWidth: 320, marginTop: spacing.xl }}>
            <PButton variant="gold" onPress={() => nav.navigate({ name: "Home" })}>Continue pathway</PButton>
          </View>
        </View>
      </View>
    );
  }

  if (phase === "result" && !passed) {
    return (
      <View style={[res.root, { backgroundColor: palette.paper }]}>
        <Header onBack={() => nav.goBack()} title="Module quiz" />
        <View style={res.center}>
          <View style={res.book}><T style={{ fontSize: 40 }}>📖</T></View>
          <T style={[res.bigGold, { color: palette.ink }]}>{score}%</T>
          <T variant="title" style={{ marginTop: spacing.xs }}>Almost there</T>
          <T variant="bodyLg" tone="secondary" style={{ marginTop: spacing.sm, textAlign: "center", maxWidth: 300 }}>
            You need {PASS}% to pass. Take a moment to review the lesson — you've got this.
          </T>
          <View style={{ width: "100%", maxWidth: 320, marginTop: spacing.xl, gap: spacing.md }}>
            <PButton variant="primary" onPress={() => nav.navigate({ name: "Module", moduleId })}>Review lesson</PButton>
            <PButton variant="ghost" onPress={retry}>Retry quiz</PButton>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: palette.paper }}>
      <View style={{ backgroundColor: palette.navy, paddingTop: 52, paddingHorizontal: spacing.base, paddingBottom: spacing.lg }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => nav.goBack()} style={res.iconBtn}>
            <T tone="onNavy" variant="heading">‹</T>
          </Pressable>
          <View style={{ flex: 1 }}>
            <T variant="micro" tone="onNavyDim" style={{ letterSpacing: 1.2 }}>MODULE QUIZ</T>
            <T variant="heading" tone="onNavy">The Church of Christ</T>
          </View>
        </View>
        <View style={res.dots}>
          {QUESTIONS.map((_, i) => (
            <View key={i} style={[res.dot, { width: i === q ? 24 : 8, backgroundColor: i <= q ? palette.gold : "rgba(255,255,255,0.18)" }]} />
          ))}
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }} showsVerticalScrollIndicator={false}>
        <T variant="overline" tone="tertiary">QUESTION {q + 1} OF {QUESTIONS.length}</T>
        <T variant="title" style={{ marginTop: spacing.md, marginBottom: spacing.lg }}>{question.text}</T>
        <View style={{ gap: spacing.md }}>
          {question.options.map((opt, idx) => {
            const sel = selected === idx;
            return (
              <Pressable
                key={idx}
                accessibilityRole="radio"
                accessibilityState={{ selected: sel }}
                onPress={() => setSelected(idx)}
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
      </ScrollView>

      <View style={res.footer}>
        <PButton onPress={next} disabled={selected === null}>{isLast ? "Submit answers" : "Next question"}</PButton>
      </View>
    </View>
  );
}

function Header({ onBack, title }: { onBack: () => void; title: string }): ReactElement {
  return (
    <View style={res.header}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onBack} style={res.iconBtn}>
        <T tone="onNavy" variant="heading">‹</T>
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
