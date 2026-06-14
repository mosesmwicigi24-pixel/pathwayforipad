// Chat thread (new design, mobile "Chat" make). The conversation view for a DM,
// cell group, or space: messages with author + reactions, a composer, and a
// react affordance. Sends go through writeThrough — online they post immediately,
// offline they queue (chat_messages:create) and replay on reconnect (§1.7).
// Opening the thread marks it read.
import { useEffect, useRef, useState, type ReactElement } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, TextInput, View } from "react-native";
import { launchImageLibrary } from "react-native-image-picker";
import { ArrowLeft, Hash, ImagePlus, Play, Users } from "lucide-react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { RootStackParamList } from "../navigation/types";
import type { ChatMessage } from "../api/types";
import { NuruApi } from "../api/client";
import { uuidv4 } from "../util/uuid";
import { palette, radii, spacing, shadow } from "../theme/tokens";
import { PButton, T } from "../theme/components";
import { useChatConversation, queryKeys } from "../api/hooks";
import { errorMessage, invalidateQueries } from "../api/query";
import { uploadToSignedUrl } from "../api/upload";
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

  async function attachImage(): Promise<void> {
    // Media requires connectivity — bytes upload direct to storage, not queued (§4.5).
    if (!(await getConnectivity().isOnline())) {
      setSendError("You're offline — images need a connection.");
      return;
    }
    const result = await launchImageLibrary({ mediaType: "photo", quality: 0.8, selectionLimit: 1 });
    const asset = result.assets?.[0];
    if (!asset?.uri) return; // cancelled
    setSending(true);
    setSendError(null);
    try {
      const contentType = asset.type ?? "image/jpeg";
      const signed = await NuruApi.signChatAttachment({ content_type: contentType, kind: "image" });
      await uploadToSignedUrl(signed.upload_url, asset.uri, contentType);
      await NuruApi.sendChatMessage(conversationId, {
        message_id: uuidv4(),
        body: "",
        msg_type: "image",
        attachment_url: signed.object_key,
        client_mutation_id: uuidv4(),
      });
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
            <View style={{ flexDirection: "row", alignItems: "flex-end", gap: spacing.sm }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Add photo"
                onPress={() => void attachImage()}
                disabled={sending}
                style={({ pressed }) => [st.attachBtn, pressed && { transform: [{ scale: 0.95 }] }]}
              >
                <ImagePlus size={20} color={palette.navy} />
              </Pressable>
              <TextInput
                value={text}
                onChangeText={setText}
                placeholder="Message…"
                placeholderTextColor={palette.ink400}
                accessibilityLabel="Message"
                multiline
                style={[st.input, { flex: 1 }]}
              />
            </View>
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
        {m.msg_type === "image" && m.attachment_url ? (
          <AttachmentImage objectKey={m.attachment_url} />
        ) : m.msg_type === "voice" ? (
          <View style={st.mediaChip}><Play size={14} color={m.mine ? "#fff" : palette.navy} /><T variant="caption" style={{ color: m.mine ? "#fff" : palette.ink }}>Voice message</T></View>
        ) : m.msg_type === "video" && m.attachment_url ? (
          <View style={st.mediaChip}><Play size={14} color={m.mine ? "#fff" : palette.navy} /><T variant="caption" style={{ color: m.mine ? "#fff" : palette.ink }}>Video</T></View>
        ) : null}
        {m.body ? <T variant="body" style={{ color: m.mine ? "#fff" : palette.ink, marginTop: m.msg_type !== "text" ? 6 : 0 }}>{m.body}</T> : null}
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

/** Resolves a chat image's signed delivery URL on mount, then renders it. */
function AttachmentImage({ objectKey }: { objectKey: string }): ReactElement {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    NuruApi.resolveMediaUrl(objectKey)
      .then((r) => { if (live) setUrl(r.url); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [objectKey]);
  if (failed) return <View style={st.imageBox}><T variant="caption" tone="tertiary">Image unavailable</T></View>;
  if (!url) return <View style={st.imageBox}><ActivityIndicator color={palette.gold} /></View>;
  return <Image source={{ uri: url }} style={st.image} resizeMode="cover" accessibilityLabel="Shared photo" />;
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
  attachBtn: { width: 46, height: 46, borderRadius: 23, backgroundColor: palette.coolPaper, borderWidth: 1, borderColor: palette.border, alignItems: "center", justifyContent: "center" },
  image: { width: 220, height: 220, borderRadius: 14, marginBottom: 2 },
  imageBox: { width: 220, height: 220, borderRadius: 14, backgroundColor: "rgba(11,31,51,0.06)", alignItems: "center", justifyContent: "center", marginBottom: 2 },
  mediaChip: { flexDirection: "row", alignItems: "center", gap: 6 },
  composer: {
    borderTopWidth: 1, borderTopColor: palette.border, backgroundColor: palette.white,
    paddingHorizontal: spacing.screen, paddingTop: spacing.md, paddingBottom: spacing.lg,
  },
  input: {
    backgroundColor: palette.coolPaper, borderRadius: radii.control, borderWidth: 1, borderColor: palette.border,
    paddingHorizontal: spacing.base, paddingTop: spacing.md, minHeight: 48, maxHeight: 120, fontSize: 15, color: palette.ink, textAlignVertical: "top",
  },
} as const;
