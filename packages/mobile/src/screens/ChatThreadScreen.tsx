// Chat thread (new design, mobile "Chat" make). The conversation view for a DM,
// cell group, or space: messages with author + reactions, a composer, and a
// react affordance. Sends go through writeThrough — online they post immediately,
// offline they queue (chat_messages:create) and replay on reconnect (§1.7).
// Opening the thread marks it read.
import { useEffect, useRef, useState, type ReactElement } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";
import { ArrowLeft, Hash, Users } from "lucide-react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { RootStackParamList } from "../navigation/types";
import type { ChatMessage } from "../api/types";
import { NuruApi } from "../api/client";
import { uuidv4 } from "../util/uuid";
import { palette, radii, spacing, shadow } from "../theme/tokens";
import { PButton, T } from "../theme/components";
import { useChatConversation, queryKeys } from "../api/hooks";
import { errorMessage, invalidateQueries } from "../api/query";
import { writeThrough } from "../sync/offlineWrite";
import { getSyncEngine } from "../sync/engineProvider";
import { getConnectivity } from "../net/connectivity";
import { Loading, ErrorState } from "../components/states";

const QUICK = ["🙏", "❤️", "🔥", "🎉"];

function when(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export function ChatThreadScreen(): ReactElement {
  const nav = useNavigation();
  const route = useRoute<RouteProp<RootStackParamList, "ChatThread">>();
  const { conversationId } = route.params;
  const { data: convo, isLoading, error, refetch } = useChatConversation(conversationId);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [reactingId, setReactingId] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  // Mark read on open; refresh the inbox so the unread badge clears.
  useEffect(() => {
    void NuruApi.markChatRead(conversationId)
      .then(() => invalidateQueries(queryKeys.chatInbox))
      .catch(() => undefined);
  }, [conversationId]);

  async function send(): Promise<void> {
    const body = text.trim();
    if (!body) return;
    setSending(true);
    setSendError(null);
    try {
      const payload = { conversation_id: conversationId, message_id: uuidv4(), body, client_mutation_id: uuidv4() };
      await writeThrough({
        engine: getSyncEngine(),
        connectivity: getConnectivity(),
        online: () => NuruApi.sendChatMessage(conversationId, { message_id: payload.message_id, body, client_mutation_id: payload.client_mutation_id }),
        queued: { domain: "chat_messages", op: "create", payload },
      });
      setText("");
      invalidateQueries(queryKeys.chatConvo(conversationId));
      invalidateQueries(queryKeys.chatInbox);
      void refetch();
    } catch (e) {
      setSendError(errorMessage(e));
    } finally {
      setSending(false);
    }
  }

  async function react(messageId: string, emoji: string): Promise<void> {
    setReactingId(null);
    try {
      await NuruApi.toggleChatReaction(messageId, emoji);
      void refetch();
    } catch {
      /* best-effort; a failed reaction shouldn't interrupt the conversation */
    }
  }

  return (
    <View style={st.screen}>
      <View style={st.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => nav.goBack()} style={({ pressed }) => [st.iconBtn, pressed && { transform: [{ scale: 0.95 }] }]}>
          <ArrowLeft size={20} color={palette.onNavy} />
        </Pressable>
        {convo?.kind === "space" ? <Hash size={16} color={palette.gold} /> : convo?.kind === "group" ? <Users size={16} color={palette.gold} /> : null}
        <T variant="heading" tone="onNavy" style={{ flex: 1 }} numberOfLines={1}>
          {convo?.title ?? route.params.title ?? "Conversation"}
        </T>
      </View>

      {isLoading ? (
        <View style={st.center}><Loading label="Opening…" /></View>
      ) : error || !convo ? (
        <View style={st.center}><ErrorState message={errorMessage(error)} onRetry={() => void refetch()} /></View>
      ) : (
        <>
          <ScrollView
            ref={scrollRef}
            style={{ flex: 1 }}
            contentContainerStyle={{ padding: spacing.screen, paddingBottom: spacing.lg }}
            showsVerticalScrollIndicator={false}
            onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
          >
            {convo.messages.map((m) => (
              <Bubble key={m.message_id} m={m} onLongPress={() => setReactingId(m.message_id)} reacting={reactingId === m.message_id} onReact={(e) => void react(m.message_id, e)} />
            ))}
            {convo.messages.length === 0 ? (
              <T variant="caption" tone="secondary" style={{ textAlign: "center", marginTop: spacing.xl }}>
                No messages yet — say hello 👋
              </T>
            ) : null}
          </ScrollView>

          <View style={st.composer}>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder="Message…"
              placeholderTextColor={palette.ink400}
              accessibilityLabel="Message"
              multiline
              style={st.input}
            />
            {sendError ? <T variant="caption" style={{ color: palette.error, marginTop: 4 }}>{sendError}</T> : null}
            <View style={{ marginTop: spacing.sm }}>
              <PButton variant="gold" onPress={() => void send()} disabled={sending || text.trim().length === 0}>
                {sending ? "Sending…" : "Send"}
              </PButton>
            </View>
          </View>
        </>
      )}
    </View>
  );
}

function Bubble({ m, onLongPress, reacting, onReact }: { m: ChatMessage; onLongPress: () => void; reacting: boolean; onReact: (emoji: string) => void }): ReactElement {
  return (
    <View style={{ marginBottom: spacing.md, alignItems: m.mine ? "flex-end" : "flex-start" }}>
      {!m.mine ? <T variant="micro" tone="tertiary" style={{ marginBottom: 2, marginLeft: spacing.sm }}>{m.author_name}</T> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="React"
        onLongPress={onLongPress}
        delayLongPress={250}
        style={[st.bubble, m.mine ? st.bubbleMine : st.bubbleOther]}
      >
        {m.reply_body ? (
          <View style={st.reply}>
            <T variant="micro" tone={m.mine ? "onNavy" : "tertiary"} numberOfLines={1}>{m.reply_author}: {m.reply_body}</T>
          </View>
        ) : null}
        {m.ai_tag ? <T variant="micro" tone="gold" style={{ marginBottom: 2 }}>✨ {m.ai_tag.toUpperCase()}</T> : null}
        <T variant="body" style={{ color: m.mine ? "#fff" : palette.ink }}>{m.body}</T>
        <T variant="micro" style={{ color: m.mine ? "rgba(255,255,255,0.6)" : palette.ink400, marginTop: 4, alignSelf: "flex-end" }}>{when(m.created_at)}</T>
      </Pressable>

      {m.reactions.length > 0 ? (
        <View style={{ flexDirection: "row", gap: 4, marginTop: 4 }}>
          {m.reactions.map((r) => (
            <Pressable key={r.emoji} onPress={() => onReact(r.emoji)} style={[st.reaction, r.mine && { borderColor: palette.gold }]}>
              <T variant="micro">{r.emoji} {r.count}</T>
            </Pressable>
          ))}
        </View>
      ) : null}

      {reacting ? (
        <View style={st.reactBar}>
          {QUICK.map((e) => (
            <Pressable key={e} onPress={() => onReact(e)} style={st.reactPick}><T variant="body">{e}</T></Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const st = {
  screen: { flex: 1, backgroundColor: palette.coolPaper },
  header: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    backgroundColor: palette.navy, paddingTop: 54, paddingBottom: spacing.base, paddingHorizontal: spacing.lg,
  },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.10)", alignItems: "center", justifyContent: "center" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  bubble: { maxWidth: "82%", borderRadius: 18, paddingHorizontal: spacing.base, paddingVertical: spacing.sm, ...shadow.card },
  bubbleMine: { backgroundColor: palette.navy, borderBottomRightRadius: 6 },
  bubbleOther: { backgroundColor: palette.white, borderWidth: 1, borderColor: palette.border, borderBottomLeftRadius: 6 },
  reply: { borderLeftWidth: 2, borderLeftColor: palette.gold, paddingLeft: spacing.sm, marginBottom: 4, opacity: 0.85 },
  reaction: { borderWidth: 1, borderColor: palette.border, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 2, backgroundColor: palette.white },
  reactBar: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm, backgroundColor: palette.white, borderRadius: 20, borderWidth: 1, borderColor: palette.border, paddingHorizontal: spacing.md, paddingVertical: 6, ...shadow.card },
  reactPick: { paddingHorizontal: 4 },
  composer: {
    borderTopWidth: 1, borderTopColor: palette.border, backgroundColor: palette.white,
    paddingHorizontal: spacing.screen, paddingTop: spacing.md, paddingBottom: spacing.lg,
  },
  input: {
    backgroundColor: palette.coolPaper, borderRadius: radii.control, borderWidth: 1, borderColor: palette.border,
    paddingHorizontal: spacing.base, paddingTop: spacing.md, minHeight: 48, maxHeight: 120, fontSize: 15, color: palette.ink, textAlignVertical: "top",
  },
} as const;
