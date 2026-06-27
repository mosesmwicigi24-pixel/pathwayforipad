// Reflection (Figma "Reflection"). A dedicated reflection experience with two
// modes: a COMPOSER (prompt + guiding scripture + a quiet writing area with a
// word-count guide) and a STATUS view (review state, the submitted body, and the
// mentor's note when a reflection is returned). Reached from a reflection-gated
// module's review banner. The submission is offline-safe (writeThrough) and the
// SERVER stays authoritative for gating (§1.1) — a returned reflection re-opens
// the composer for a resubmission (M3 over B3).
import { useEffect, useMemo, useState, type ReactElement } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";
import { BookMarked, Check, ChevronLeft, Clock, RefreshCcw, type LucideIcon } from "lucide-react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { palette, spacing, shadow } from "../theme/tokens";
import { T } from "../theme/components";
import { Loading, ErrorState } from "../components/states";
import { Confetti } from "../components/Confetti";
import { useKeyboardInset } from "../components/useKeyboardInset";
import { useModule, useMyReflection, useScripture, queryKeys } from "../api/hooks";
import { NuruApi } from "../api/client";
import { errorMessage, invalidateQueries, useMutation } from "../api/query";
import { writeThrough } from "../sync/offlineWrite";
import { getSyncEngine } from "../sync/engineProvider";
import { getConnectivity } from "../net/connectivity";
import type { MyReflection } from "../api/types";

const MIN_WORDS = 80;
const DEFAULT_PROMPT =
  "Where have you seen God at work in your week, and where might He be inviting you to respond more deeply?";

// App review states → the Figma's status presentation. "rejected" is treated as
// "returned" (both reopen the composer for a resubmission).
type Status = "pending" | "approved" | "returned" | "deferred";
function toStatus(s: MyReflection["state"]): Status {
  if (s === "rejected") return "returned";
  return s;
}
const STATUS_META: Record<Status, { label: string; color: string; bg: string; Icon: LucideIcon }> = {
  pending: { label: "Pending review", color: "#4338CA", bg: "#E0E7FF", Icon: Clock },
  approved: { label: "Approved", color: "#166534", bg: "#DCFCE7", Icon: Check },
  returned: { label: "Returned", color: "#92400E", bg: "#FEF3C7", Icon: RefreshCcw },
  deferred: { label: "Deferred", color: "#6B7280", bg: "#F3F4F6", Icon: Clock },
};

export function ReflectionScreen(): ReactElement {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { moduleId } = useRoute<RouteProp<RootStackParamList, "Reflection">>().params;
  const { data: module, isLoading, error, refetch } = useModule(moduleId);
  const { data: reflection, refetch: refetchReflection } = useMyReflection(moduleId);

  const scriptureRef = module?.key_verses?.[0] ?? "Matthew 7:24";
  const { data: verse } = useScripture(scriptureRef);
  const scripture = {
    ref: verse?.reference ?? scriptureRef,
    text: verse?.text ?? "Everyone who hears these words of mine and acts on them is like a wise man who built his house on the rock.",
  };

  const status = reflection ? toStatus(reflection.state) : null;
  // Show the composer when nothing is submitted yet, or on a deliberate revise.
  const [revising, setRevising] = useState(false);
  // Celebrate a completed module the moment the reflection is submitted.
  const [celebrate, setCelebrate] = useState(false);
  const composing = !reflection || revising || status === "returned";

  const submit = useMutation((body: { reflection_text: string }) =>
    writeThrough({
      engine: getSyncEngine(),
      connectivity: getConnectivity(),
      online: () => NuruApi.completeModule(moduleId, body),
      queued: { domain: "module_progress", op: "complete", payload: { module_id: moduleId, reflection_text: body.reflection_text } },
    }),
  );

  async function onSubmit(text: string): Promise<void> {
    try {
      const out = await submit.mutate({ reflection_text: text });
      invalidateQueries("pathway");
      if (module) invalidateQueries(`levelModules:${module.level_number}`);
      invalidateQueries(`module:${moduleId}`);
      invalidateQueries(queryKeys.myReflection(moduleId));
      invalidateQueries("achievements");
      void refetchReflection();
      setRevising(false);
      setCelebrate(true);
      // Let the confetti play before leaving when the write was queued offline.
      if (out.queued) setTimeout(() => nav.goBack(), 1500);
    } catch {
      // surfaced via submit.error
    }
  }

  if (isLoading || (!module && !error)) {
    return (
      <View style={{ flex: 1, backgroundColor: "#F6F4EE" }}>
        <Header onBack={() => nav.goBack()} overline="REFLECTION" title="Loading…" />
        <Loading label="Loading reflection…" />
      </View>
    );
  }
  if (error || !module) {
    return (
      <View style={{ flex: 1, backgroundColor: "#F6F4EE" }}>
        <Header onBack={() => nav.goBack()} overline="REFLECTION" title="Reflection" />
        <View style={{ padding: spacing.screen }}>
          <ErrorState message={errorMessage(error)} onRetry={() => void refetch()} />
        </View>
      </View>
    );
  }

  const moduleLabel = `Module ${module.module_sequence_number} · ${module.title}`;

  return (
    <View style={{ flex: 1 }}>
      {composing ? (
        <Composer
          moduleLabel={moduleLabel}
          prompt={DEFAULT_PROMPT}
          scripture={scripture}
          initial={revising ? (reflection?.body ?? "") : ""}
          submitting={submit.isLoading}
          errorText={submit.error ? errorMessage(submit.error) : null}
          onBack={() => (revising ? setRevising(false) : nav.goBack())}
          onSubmit={(text) => void onSubmit(text)}
        />
      ) : (
        <StatusView
          reflection={reflection!}
          status={status!}
          moduleLabel={moduleLabel}
          prompt={DEFAULT_PROMPT}
          scripture={scripture}
          onBack={() => nav.goBack()}
          onRevise={() => setRevising(true)}
        />
      )}
      <Confetti show={celebrate} count={100} onDone={() => setCelebrate(false)} />
    </View>
  );
}

function Composer({
  moduleLabel, prompt, scripture, initial, submitting, errorText, onBack, onSubmit,
}: {
  moduleLabel: string;
  prompt: string;
  scripture: { ref: string; text: string };
  initial: string;
  submitting: boolean;
  errorText: string | null;
  onBack: () => void;
  onSubmit: (text: string) => void;
}): ReactElement {
  const [body, setBody] = useState(initial);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const kbInset = useKeyboardInset();
  const words = useMemo(() => (body.trim() ? body.trim().split(/\s+/).length : 0), [body]);
  const canSubmit = words >= MIN_WORDS && !submitting;

  // Local autosave indicator (drafts stay client-side).
  useEffect(() => {
    if (!body) return;
    const t = setTimeout(() => setSavedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })), 600);
    return () => clearTimeout(t);
  }, [body]);

  return (
    <View style={{ flex: 1, backgroundColor: "#F6F4EE" }}>
      <Header onBack={onBack} overline="REFLECTION" title={moduleLabel} right={savedAt ? `Draft saved · ${savedAt}` : "—"} />
      <ScrollView contentContainerStyle={{ padding: spacing.screen, paddingBottom: 130 + kbInset }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <Card>
          <T variant="micro" tone="tertiary" style={st.kicker}>PROMPT</T>
          <T variant="bodyLg" style={{ marginTop: spacing.sm, color: palette.ink, lineHeight: 24 }}>{prompt}</T>
        </Card>

        <ScriptureCard scripture={scripture} />

        <View style={[st.card, { marginTop: spacing.md, padding: spacing.md }]}>
          <TextInput
            value={body}
            onChangeText={setBody}
            placeholder="Write quietly. What is the Spirit drawing your attention to?"
            placeholderTextColor={palette.ink400}
            multiline
            style={st.input}
            textAlignVertical="top"
            accessibilityLabel="Your reflection"
          />
          <View style={st.counter}>
            <T variant="micro" tone="tertiary">{`${words} words`}</T>
            <T variant="micro" tone="tertiary">{words < MIN_WORDS ? `${MIN_WORDS - words} more to submit` : "Ready to submit"}</T>
          </View>
        </View>

        {errorText ? <T variant="caption" style={{ color: palette.error, marginTop: spacing.base }}>{errorText}</T> : null}
      </ScrollView>

      <View style={[st.footer, { marginBottom: kbInset }]}>
        <SubmitButton label={submitting ? "Submitting…" : "Submit reflection"} disabled={!canSubmit} onPress={() => onSubmit(body)} />
      </View>
    </View>
  );
}

function StatusView({
  reflection, status, moduleLabel, prompt, scripture, onBack, onRevise,
}: {
  reflection: MyReflection;
  status: Status;
  moduleLabel: string;
  prompt: string;
  scripture: { ref: string; text: string };
  onBack: () => void;
  onRevise: () => void;
}): ReactElement {
  const meta = STATUS_META[status];
  const submitted = formatWhen(reflection.submitted_at);

  return (
    <View style={{ flex: 1, backgroundColor: "#F6F4EE" }}>
      <Header onBack={onBack} overline={moduleLabel} title="Your reflection" right={submitted} />
      <ScrollView contentContainerStyle={{ padding: spacing.screen, paddingBottom: status === "returned" ? 130 : spacing.xxl }} showsVerticalScrollIndicator={false}>
        {/* Status pill */}
        <View style={[st.statusRow, { borderColor: `${meta.color}40`, backgroundColor: meta.bg }]}>
          <View style={st.statusIcon}><meta.Icon size={17} color={meta.color} /></View>
          <View style={{ minWidth: 0 }}>
            <T variant="caption" style={{ color: meta.color, fontWeight: "700" }}>{meta.label}</T>
            <T variant="micro" tone="tertiary">{`Submitted ${submitted}`}</T>
          </View>
        </View>

        <Card style={{ marginTop: spacing.base }}>
          <T variant="micro" tone="tertiary" style={st.kicker}>PROMPT</T>
          <T variant="body" style={{ marginTop: spacing.sm, color: palette.ink, lineHeight: 24 }}>{prompt}</T>
        </Card>

        <ScriptureCard scripture={scripture} />

        <Card style={{ marginTop: spacing.md }}>
          <T variant="micro" tone="tertiary" style={st.kicker}>YOUR REFLECTION</T>
          <T variant="body" style={{ marginTop: spacing.sm, color: palette.ink, lineHeight: 24 }}>{reflection.body}</T>
        </Card>

        {status === "returned" && reflection.feedback_notes ? (
          <View style={[st.card, st.feedback, { marginTop: spacing.md }]}>
            <T variant="micro" style={{ color: "#92400E", fontWeight: "700", letterSpacing: 1.2 }}>MENTOR FEEDBACK</T>
            <T variant="body" style={{ marginTop: spacing.sm, color: palette.ink, lineHeight: 24 }}>{reflection.feedback_notes}</T>
          </View>
        ) : null}

        {status === "deferred" ? (
          <View style={[st.card, { marginTop: spacing.base, padding: spacing.md }]}>
            <T variant="caption" tone="tertiary">Review scheduled — your mentor will respond soon.</T>
          </View>
        ) : null}
      </ScrollView>

      {status === "returned" ? (
        <View style={st.footer}>
          <SubmitButton label="Revise & resubmit" Icon={RefreshCcw} onPress={onRevise} />
        </View>
      ) : null}
    </View>
  );
}

function Header({ onBack, overline, title, right }: { onBack: () => void; overline: string; title: string; right?: string }): ReactElement {
  return (
    <View style={st.header}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onBack} style={({ pressed }) => [st.backBtn, pressed && { backgroundColor: "rgba(10,37,64,0.06)" }]}>
        <ChevronLeft size={22} color={palette.navy} />
      </Pressable>
      <View style={{ flex: 1, minWidth: 0 }}>
        <T variant="micro" style={{ color: "#A8861C", fontWeight: "700", letterSpacing: 1.4 }} numberOfLines={1}>{overline.toUpperCase()}</T>
        <T variant="heading" style={{ marginTop: 1 }} numberOfLines={1}>{title}</T>
      </View>
      {right ? <T variant="micro" tone="tertiary">{right}</T> : null}
    </View>
  );
}

function Card({ children, style }: { children: ReactElement | ReactElement[]; style?: object }): ReactElement {
  return <View style={[st.card, { padding: spacing.base }, style]}>{children}</View>;
}

function ScriptureCard({ scripture }: { scripture: { ref: string; text: string } }): ReactElement {
  return (
    <View style={st.scripture}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <BookMarked size={14} color="#8A6B10" />
        <T variant="micro" style={{ color: "#8A6B10", fontWeight: "700", letterSpacing: 1.2 }}>GUIDING SCRIPTURE</T>
      </View>
      <T serif style={{ marginTop: spacing.sm, fontSize: 15, lineHeight: 24, color: palette.ink }}>{`“${scripture.text}”`}</T>
      <T variant="micro" style={{ color: "#8A6B10", fontWeight: "600", marginTop: spacing.sm }}>{scripture.ref}</T>
    </View>
  );
}

function SubmitButton({ label, disabled, onPress, Icon }: { label: string; disabled?: boolean; onPress: () => void; Icon?: LucideIcon }): ReactElement {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [st.submit, disabled && { opacity: 0.4 }, pressed && !disabled && { transform: [{ scale: 0.99 }] }]}
    >
      {Icon ? <Icon size={16} color={palette.gold} /> : null}
      <T variant="heading" style={{ color: palette.gold, fontWeight: "700" }}>{label}</T>
    </Pressable>
  );
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " · " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

const st = {
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: palette.white, paddingHorizontal: spacing.sm, paddingTop: 52, paddingBottom: spacing.md, ...shadow.card },
  backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  kicker: { fontWeight: "700", letterSpacing: 1.4 },
  card: { backgroundColor: palette.white, borderRadius: 22, borderWidth: 1, borderColor: palette.border, padding: spacing.base, ...shadow.card },
  scripture: { marginTop: spacing.md, backgroundColor: "#FFF8DD", borderRadius: 22, borderWidth: 1, borderColor: "rgba(201,162,39,0.25)", padding: spacing.base },
  input: { minHeight: 200, fontSize: 15, lineHeight: 24, color: palette.ink, padding: spacing.sm },
  counter: { flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: "rgba(10,37,64,0.06)", paddingTop: spacing.sm, paddingHorizontal: spacing.sm, marginTop: spacing.xs },
  statusRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, borderRadius: 16, borderWidth: 1, padding: spacing.md },
  statusIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: palette.white, alignItems: "center", justifyContent: "center" },
  feedback: { backgroundColor: "#FEF3C7", borderColor: "rgba(245,158,11,0.30)" },
  footer: { borderTopWidth: 1, borderTopColor: palette.border, backgroundColor: palette.white, paddingHorizontal: spacing.screen, paddingTop: spacing.base, paddingBottom: spacing.lg },
  submit: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: palette.navy, borderRadius: 18, paddingVertical: 15, ...shadow.card },
} as const;
