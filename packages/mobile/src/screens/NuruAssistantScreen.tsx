// Nuru — the in-app AI companion (new design, mobile "Chat" make). A chat with
// the assistant: suggestion chips, a typing indicator, and a composer. Every
// turn calls the backend proxy (POST /assistant/chat) — the provider key lives
// server-side, never on device (§5.10). History is kept on-device and replayed
// each turn (the assistant is stateless server-side). AI needs connectivity, so
// failures surface gently rather than queueing.
import { useRef, useState, type ReactElement } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";
import { ChevronLeft, SendHorizontal, Sparkles } from "lucide-react-native";
import { useNavigation } from "@react-navigation/native";
import type { NuruTurn } from "../api/types";
import { NuruApi } from "../api/client";
import { palette, radii, spacing, shadow } from "../theme/tokens";
import { T } from "../theme/components";
import { errorMessage } from "../api/query";
import { useKeyboardInset } from "../components/useKeyboardInset";

const SUGGESTIONS = ["Summarize my cohort", "Draft an encouragement", "Find prayer requests", "Plan my quiet time"];

interface Msg extends NuruTurn {
  id: string;
}

let counter = 0;
const nextId = (): string => `n${++counter}`;

const WELCOME: Msg = {
  id: "welcome",
  role: "assistant",
  text: "Hi, I'm Nuru ✨ your AI companion. I can summarize chats, draft an encouragement, surface prayer requests, or simply talk it through. How can I help today?",
};

export function NuruAssistantScreen(): ReactElement {
  const nav = useNavigation();
  const [messages, setMessages] = useState<Msg[]>([WELCOME]);
  const [draft, setDraft] = useState("");
  const [typing, setTyping] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const kbInset = useKeyboardInset();

  async function ask(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed || typing) return;
    const mine: Msg = { id: nextId(), role: "user", text: trimmed };
    const history = [...messages, mine];
    setMessages(history);
    setDraft("");
    setTyping(true);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    try {
      const turns: NuruTurn[] = history.filter((m) => m.id !== "welcome").map((m) => ({ role: m.role, text: m.text }));
      const { reply } = await NuruApi.assistantChat({ messages: turns });
      setMessages((prev) => [...prev, { id: nextId(), role: "assistant", text: reply }]);
    } catch (e) {
      setMessages((prev) => [...prev, { id: nextId(), role: "assistant", text: `I couldn't reach my thoughts just now (${errorMessage(e)}). Try again in a moment.` }]);
    } finally {
      setTyping(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    }
  }

  return (
    <View style={st.screen}>
      <View style={st.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => nav.goBack()} style={({ pressed }) => [st.iconBtn, pressed && { transform: [{ scale: 0.95 }] }]}>
          <ChevronLeft size={22} color="#fff" />
        </Pressable>
        <View style={st.orb}><Sparkles size={18} color="#fff" /></View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <T serif tone="onNavy" style={{ fontSize: 20 }}>Nuru</T>
            <View style={st.aiTag}><T variant="micro" style={{ color: palette.navy, fontWeight: "800", fontSize: 8 }}>AI</T></View>
          </View>
          <T variant="micro" style={{ color: "rgba(255,255,255,0.7)" }}>Online · ready when you are</T>
        </View>
      </View>

      <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={{ padding: spacing.screen, paddingBottom: spacing.lg }} showsVerticalScrollIndicator={false}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.base }}>
          {SUGGESTIONS.map((s) => (
            <Pressable key={s} onPress={() => void ask(s)} style={({ pressed }) => [st.chip, pressed && { opacity: 0.7 }]}>
              <T variant="micro" style={{ color: palette.navy, fontWeight: "600" }}>{s}</T>
            </Pressable>
          ))}
        </View>

        {messages.map((m) => (
          <View key={m.id} style={{ marginBottom: spacing.md, alignItems: m.role === "user" ? "flex-end" : "flex-start" }}>
            <View style={[st.bubble, m.role === "user" ? st.mine : st.nuru]}>
              <T variant="body" style={{ color: m.role === "user" ? "#fff" : palette.ink }}>{m.text}</T>
            </View>
          </View>
        ))}
        {typing ? (
          <View style={{ alignItems: "flex-start", marginBottom: spacing.md }}>
            <View style={[st.bubble, st.nuru]}><T variant="body" tone="secondary">Nuru is thinking…</T></View>
          </View>
        ) : null}
      </ScrollView>

      <View style={[st.composer, { marginBottom: kbInset }]}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Ask Nuru anything…"
          placeholderTextColor={palette.ink400}
          accessibilityLabel="Message Nuru"
          multiline
          style={st.input}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send"
          onPress={() => void ask(draft)}
          disabled={draft.trim().length === 0 || typing}
          style={({ pressed }) => [st.send, (draft.trim().length === 0 || typing) && { opacity: 0.4 }, pressed && { transform: [{ scale: 0.95 }] }]}
        >
          <SendHorizontal size={18} color="#fff" />
        </Pressable>
      </View>
    </View>
  );
}

const st = {
  screen: { flex: 1, backgroundColor: palette.coolPaper },
  header: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    backgroundColor: "#2a1259", paddingTop: 54, paddingBottom: spacing.base, paddingHorizontal: spacing.lg,
  },
  iconBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  orb: { width: 40, height: 40, borderRadius: 13, backgroundColor: "#7c3aed", alignItems: "center", justifyContent: "center" },
  aiTag: { backgroundColor: "#a78bfa", borderRadius: 8, paddingHorizontal: 5, paddingVertical: 1 },
  chip: { backgroundColor: palette.white, borderRadius: 16, borderWidth: 1, borderColor: "rgba(124,58,237,0.35)", paddingHorizontal: spacing.md, paddingVertical: 7 },
  bubble: { maxWidth: "85%", borderRadius: 18, paddingHorizontal: spacing.base, paddingVertical: spacing.sm, ...shadow.card },
  mine: { backgroundColor: palette.navy, borderBottomRightRadius: 6 },
  nuru: { backgroundColor: palette.white, borderWidth: 1, borderColor: palette.border, borderBottomLeftRadius: 6 },
  composer: {
    flexDirection: "row", alignItems: "flex-end", gap: spacing.sm,
    borderTopWidth: 1, borderTopColor: palette.border, backgroundColor: palette.white,
    paddingHorizontal: spacing.screen, paddingTop: spacing.md, paddingBottom: spacing.lg,
  },
  input: {
    flex: 1, backgroundColor: palette.coolPaper, borderRadius: radii.control, borderWidth: 1, borderColor: palette.border,
    paddingHorizontal: spacing.base, paddingTop: spacing.md, minHeight: 46, maxHeight: 120, fontSize: 15, color: palette.ink, textAlignVertical: "top",
  },
  send: { width: 46, height: 46, borderRadius: 23, backgroundColor: "#7c3aed", alignItems: "center", justifyContent: "center" },
} as const;
