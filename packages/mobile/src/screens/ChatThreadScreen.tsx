// Chat thread — redesigned to the Figma "Aurora" make. A warm canvas with soft
// floating bubbles (no tails): incoming light, outgoing navy gradient, per-sender
// color coding in groups/spaces, reply-quote chips, reaction pills, read ticks, and
// date dividers. The composer carries a "+" attachment grid, an emoji strip, a Nuru
// AI assist, and a voice recorder. A long-press opens an action sheet (reply / copy
// / forward / star / edit / delete). All data + wiring is real: sends go through
// writeThrough — online they post immediately, offline they queue
// (chat_messages:create) and replay on reconnect (§1.7); media uploads sign →
// Cloudinary and are never queued (§4.5); opening the thread marks it read.
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Clipboard,
  FlatList,
  Image,
  Keyboard,
  Linking,
  Modal,
  PermissionsAndroid,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import { launchCamera, launchImageLibrary } from "react-native-image-picker";
import AudioRecorderPlayer from "react-native-audio-recorder-player";
import { pick as pickDocument, isCancel } from "react-native-document-picker";
import {
  Camera,
  ChevronLeft,
  Copy,
  CornerUpLeft,
  FileText,
  Forward,
  Hash,
  ImagePlus,
  Info,
  Mic,
  Paperclip,
  Pause,
  Pencil,
  Play,
  Plus,
  SendHorizontal,
  Smile,
  Sparkles,
  Square,
  Star,
  Trash2,
  Users,
  Video,
  X,
} from "lucide-react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import type { ChatMessage, ChatReaders, ChatThreadDetail } from "../api/types";
import { initials } from "./chatInbox";
import { NuruApi } from "../api/client";
import { uuidv4 } from "../util/uuid";
import { cdnImage } from "../util/cdnImage";
import { palette, radii, spacing, shadow } from "../theme/tokens";
import { T, GradientBg } from "../theme/components";
import { useChatConversation, useMe, queryKeys } from "../api/hooks";
import { errorMessage, refreshQueries } from "../api/query";
import { writeThrough } from "../sync/offlineWrite";
import { getSyncEngine } from "../sync/engineProvider";
import { getConnectivity } from "../net/connectivity";
import { Loading, ErrorState } from "../components/states";
import { VideoPlayer } from "../components/VideoPlayer";
import { FitImage } from "../components/FitImage";
import { Avatar } from "../components/Avatar";
import { CHAT, ReadTicks, Waveform, DateDivider, senderColor } from "../components/ChatKit";
import { formatMillis, voiceFileName, voiceAttachmentMeta, fileAttachmentMeta, voiceLabel, fileLabel, formatBytes } from "./chatMediaHelpers";

// Tap-to-fill suggested replies above the composer.
const QUICK_REPLIES = ["Amen 🙏", "Praying for you 💛", "On my way 🏃", "Thank you 🙏"];
const QUICK_REACTIONS = ["🙏", "❤️", "🔥", "🎉"];
const EMOJIS = ["🙏", "❤️", "🔥", "🎉", "🙌", "😊", "🥹", "💛", "✝️", "🕊️", "👏", "🤝", "😀", "😇", "🤗", "💪", "🌅", "📖"];

/** Friendly composer error — soften the backend's "media not configured". */
function composerError(e: unknown): string {
  const msg = errorMessage(e);
  return /not configured/i.test(msg) ? "Photos & files aren't enabled here yet." : msg;
}

/** A short subtitle under the thread title: kind (+ room type) and member count. */
function threadSubtitle(convo: ChatThreadDetail): string {
  if (convo.kind === "dm") return "Direct message";
  const members = `${convo.member_count} ${convo.member_count === 1 ? "member" : "members"}`;
  if (convo.kind === "space") return `${convo.is_public ? "Public space" : "Space"} · ${members}`;
  const t = (convo.title ?? "").toLowerCase();
  const kind = t.includes("cohort") ? "Cohort group" : t.includes("leader") || t.includes("multiplier") ? "Leaders group" : "Cell group";
  return `${kind} · ${members}`;
}

// react-native-audio-recorder-player v4 exports a singleton instance (no `new`).
const recorder = AudioRecorderPlayer;

function when(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/** Date-divider label for a message's day: "Today", "Yesterday", or "Mar 3". */
function dayLabel(iso: string): string {
  const then = new Date(iso);
  const now = new Date();
  const startOf = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((startOf(now) - startOf(then)) / 86_400_000);
  if (diff <= 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff < 7) return then.toLocaleDateString("en-US", { weekday: "long" });
  return then.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// A row in the rendered list is either a date divider or a grouped message (with
// flags for whether it heads/tails a consecutive run by the same author).
type Row =
  | { kind: "divider"; key: string; label: string }
  | { kind: "msg"; key: string; m: ChatMessage; head: boolean; tail: boolean };

/** Build the flat list: insert date dividers and mark consecutive author runs. */
function buildRows(messages: ChatMessage[]): Row[] {
  const rows: Row[] = [];
  let lastDay = "";
  messages.forEach((m, i) => {
    const label = dayLabel(m.created_at);
    if (label !== lastDay) {
      rows.push({ kind: "divider", key: `d-${label}-${i}`, label });
      lastDay = label;
    }
    const prev = messages[i - 1];
    const next = messages[i + 1];
    const sameAsPrev = prev && prev.author_user_id === m.author_user_id && dayLabel(prev.created_at) === label;
    const sameAsNext = next && next.author_user_id === m.author_user_id && dayLabel(next.created_at) === label;
    rows.push({ kind: "msg", key: m.message_id, m, head: !sameAsPrev, tail: !sameAsNext });
  });
  return rows;
}

export function ChatThreadScreen(): ReactElement {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, "ChatThread">>();
  const { conversationId } = route.params;
  const { data: convo, isLoading, error, refetch } = useChatConversation(conversationId);
  const { data: me } = useMe();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [actionFor, setActionFor] = useState<ChatMessage | null>(null); // long-press action sheet
  const [editingId, setEditingId] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null); // reply-quote preview (display only — see report)
  const [seenBy, setSeenBy] = useState<{ msg: ChatMessage; data: ChatReaders | null } | null>(null);
  const [showAttach, setShowAttach] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiPrev, setAiPrev] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordMs, setRecordMs] = useState(0);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const recordingPath = useRef<string | null>(null);
  const recordDurationMs = useRef(0);
  const listRef = useRef<FlatList<Row>>(null);

  const group = convo?.kind === "space" || convo?.kind === "group";
  const rows = useMemo(() => (convo ? buildRows(convo.messages) : []), [convo]);

  // Lift the composer above the on-screen keyboard: track the keyboard height and
  // add it as bottom margin so the input stays visible; the flex:1 list shrinks.
  const [kbHeight, setKbHeight] = useState(0);
  useEffect(() => {
    const showEvt = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvt = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const show = Keyboard.addListener(showEvt, (e) => {
      setKbHeight(e.endCoordinates?.height ?? 0);
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    });
    const hide = Keyboard.addListener(hideEvt, () => setKbHeight(0));
    return () => { show.remove(); hide.remove(); };
  }, []);

  // Transient composer errors shouldn't linger.
  useEffect(() => {
    if (!sendError) return;
    const t = setTimeout(() => setSendError(null), 5000);
    return () => clearTimeout(t);
  }, [sendError]);

  // Tear down any in-flight recorder/player when the thread unmounts.
  useEffect(() => {
    return () => {
      recorder.removeRecordBackListener();
      recorder.removePlaybackEndListener();
      void recorder.stopRecorder().catch(() => undefined);
      void recorder.stopPlayer().catch(() => undefined);
    };
  }, []);

  // Mark read on open; refresh the inbox so the unread badge clears.
  useEffect(() => {
    void NuruApi.markChatRead(conversationId)
      .then(() => refreshQueries(queryKeys.chatInbox))
      .catch(() => undefined);
  }, [conversationId]);

  async function send(): Promise<void> {
    const body = text.trim();
    if (!body) return;
    setSending(true);
    setSendError(null);
    try {
      const replyId = replyTo?.message_id;
      const payload = { conversation_id: conversationId, message_id: uuidv4(), body, client_mutation_id: uuidv4(), ...(replyId ? { reply_to_id: replyId } : {}) };
      await writeThrough({
        engine: getSyncEngine(),
        connectivity: getConnectivity(),
        online: () => NuruApi.sendChatMessage(conversationId, { message_id: payload.message_id, body, client_mutation_id: payload.client_mutation_id, ...(replyId ? { reply_to_id: replyId } : {}) }),
        queued: { domain: "chat_messages", op: "create", payload },
      });
      setText("");
      setAiPrev(null);
      setReplyTo(null);
      refreshQueries(queryKeys.chatConvo(conversationId));
      refreshQueries(queryKeys.chatInbox);
      void refetch();
    } catch (e) {
      setSendError(composerError(e));
    } finally {
      setSending(false);
    }
  }

  // Photo + video share react-native-image-picker; voice notes use the recorder and
  // files the document-picker. All upload direct, never queued (§4.5).
  async function attachMedia(mode: "photo" | "video", fromCamera = false): Promise<void> {
    if (!(await getConnectivity().isOnline())) {
      setSendError(`You're offline — ${mode === "video" ? "videos" : "images"} need a connection.`);
      return;
    }
    const result = fromCamera
      ? await launchCamera({ mediaType: mode, quality: 0.8, saveToPhotos: false })
      : await launchImageLibrary({ mediaType: mode, quality: 0.8, selectionLimit: 1 });
    const asset = result.assets?.[0];
    if (!asset?.uri) return;
    const isVideo = mode === "video";
    setSending(true);
    setSendError(null);
    try {
      const contentType = asset.type ?? (isVideo ? "video/mp4" : "image/jpeg");
      const name = asset.fileName ?? `${isVideo ? "video" : "photo"}-${Date.now()}.${isVideo ? "mp4" : "jpg"}`;
      const sign = await NuruApi.signChatAttachment({ content_type: contentType, kind: isVideo ? "video" : "image" });
      const up = await NuruApi.uploadChatAttachment(sign, { uri: asset.uri, name, type: contentType });
      await NuruApi.sendChatMessage(conversationId, {
        message_id: uuidv4(),
        body: "",
        msg_type: isVideo ? "video" : "image",
        attachment_url: up.secure_url,
        attachment_meta: { public_id: up.public_id, bytes: up.bytes, name },
        client_mutation_id: uuidv4(),
      });
      refreshQueries(queryKeys.chatConvo(conversationId));
      refreshQueries(queryKeys.chatInbox);
      void refetch();
    } catch (e) {
      setSendError(composerError(e));
    } finally {
      setSending(false);
    }
  }

  // ---- Voice notes (native recorder; bytes upload direct, never queued §4.5) ----
  async function requestMicPermission(): Promise<boolean> {
    if (Platform.OS !== "android") return true;
    const perm = PermissionsAndroid.PERMISSIONS.RECORD_AUDIO ?? "android.permission.RECORD_AUDIO";
    const granted = await PermissionsAndroid.request(perm, {
      title: "Microphone access",
      message: "Record voice notes to send in chat.",
      buttonPositive: "Allow",
    });
    return granted === PermissionsAndroid.RESULTS.GRANTED;
  }

  async function startRecording(): Promise<void> {
    if (!(await getConnectivity().isOnline())) {
      setSendError("You're offline — voice notes need a connection.");
      return;
    }
    if (!(await requestMicPermission())) {
      setSendError("Microphone permission is needed to record a voice note.");
      return;
    }
    setSendError(null);
    setShowAttach(false);
    setShowEmoji(false);
    setRecordMs(0);
    recordDurationMs.current = 0;
    try {
      const path = await recorder.startRecorder();
      recordingPath.current = path;
      recorder.addRecordBackListener((e) => {
        recordDurationMs.current = e.currentPosition;
        setRecordMs(e.currentPosition);
      });
      setRecording(true);
    } catch (e) {
      setSendError(composerError(e));
    }
  }

  async function cancelRecording(): Promise<void> {
    recorder.removeRecordBackListener();
    setRecording(false);
    setRecordMs(0);
    try {
      await recorder.stopRecorder();
    } catch {
      /* nothing to discard */
    }
    recordingPath.current = null;
  }

  async function stopAndSendRecording(): Promise<void> {
    recorder.removeRecordBackListener();
    setRecording(false);
    let uri: string;
    try {
      uri = await recorder.stopRecorder();
    } catch (e) {
      setSendError(composerError(e));
      return;
    }
    const path = recordingPath.current ?? uri;
    recordingPath.current = null;
    const durationMs = recordDurationMs.current;
    setRecordMs(0);
    if (!path) return;
    setSending(true);
    setSendError(null);
    try {
      const contentType = "audio/m4a";
      const name = voiceFileName();
      const sign = await NuruApi.signChatAttachment({ content_type: contentType, kind: "voice" });
      const up = await NuruApi.uploadChatAttachment(sign, { uri: path, name, type: contentType });
      await NuruApi.sendChatMessage(conversationId, {
        message_id: uuidv4(),
        body: "",
        msg_type: "voice",
        attachment_url: up.secure_url,
        attachment_meta: voiceAttachmentMeta(up, name, durationMs),
        client_mutation_id: uuidv4(),
      });
      refreshQueries(queryKeys.chatConvo(conversationId));
      refreshQueries(queryKeys.chatInbox);
      void refetch();
    } catch (e) {
      setSendError(composerError(e));
    } finally {
      setSending(false);
    }
  }

  // Tap a voice bubble to play; tap again (or another) to stop.
  async function toggleVoicePlayback(messageId: string, url: string): Promise<void> {
    if (playingId === messageId) {
      recorder.removePlaybackEndListener();
      await recorder.stopPlayer().catch(() => undefined);
      setPlayingId(null);
      return;
    }
    if (playingId) await recorder.stopPlayer().catch(() => undefined);
    setPlayingId(messageId);
    try {
      recorder.addPlaybackEndListener(() => {
        recorder.removePlaybackEndListener();
        setPlayingId(null);
      });
      await recorder.startPlayer(url);
    } catch {
      setPlayingId(null);
    }
  }

  // ---- File attachments (document picker; bytes upload direct, never queued §4.5) ----
  async function attachFile(): Promise<void> {
    if (!(await getConnectivity().isOnline())) {
      setSendError("You're offline — file attachments need a connection.");
      return;
    }
    let picked: { uri: string; name: string | null; type: string | null; size: number | null };
    try {
      const results = await pickDocument({ allowMultiSelection: false, copyTo: "cachesDirectory" });
      const first = results[0];
      if (!first) return;
      picked = first;
    } catch (e) {
      if (isCancel(e)) return;
      setSendError(composerError(e));
      return;
    }
    setSending(true);
    setSendError(null);
    try {
      const contentType = picked.type ?? "application/octet-stream";
      const name = (picked.name ?? "").trim() || `file-${Date.now()}`;
      const uploadUri = (picked as { fileCopyUri?: string | null }).fileCopyUri ?? picked.uri;
      const sign = await NuruApi.signChatAttachment({ content_type: contentType, kind: "file" });
      const up = await NuruApi.uploadChatAttachment(sign, { uri: uploadUri, name, type: contentType });
      await NuruApi.sendChatMessage(conversationId, {
        message_id: uuidv4(),
        body: "",
        msg_type: "file",
        attachment_url: up.secure_url,
        attachment_meta: fileAttachmentMeta(up, name, picked.size),
        client_mutation_id: uuidv4(),
      });
      refreshQueries(queryKeys.chatConvo(conversationId));
      refreshQueries(queryKeys.chatInbox);
      void refetch();
    } catch (e) {
      setSendError(composerError(e));
    } finally {
      setSending(false);
    }
  }

  // ── Action sheet (long-press): reply / copy / forward / star / edit / delete ──
  function cancelEdit(): void {
    setEditingId(null);
    setText("");
  }
  async function openSeenBy(m: ChatMessage): Promise<void> {
    setSeenBy({ msg: m, data: null });
    try {
      const data = await NuruApi.chatMessageReaders(m.message_id);
      setSeenBy((cur) => (cur && cur.msg.message_id === m.message_id ? { msg: m, data } : cur));
    } catch {
      setSeenBy((cur) =>
        cur && cur.msg.message_id === m.message_id
          ? { msg: m, data: { recipient_count: m.recipient_count, read_count: m.read_count, readers: [] } }
          : cur,
      );
    }
  }
  function confirmDelete(id: string): void {
    Alert.alert("Delete message?", "This removes it for everyone in the chat.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => void doDelete(id) },
    ]);
  }
  async function doDelete(id: string): Promise<void> {
    try {
      await NuruApi.deleteChatMessage(id);
      if (editingId === id) cancelEdit();
      refreshQueries(queryKeys.chatConvo(conversationId));
      refreshQueries(queryKeys.chatInbox);
      void refetch();
    } catch (e) {
      setSendError(composerError(e));
    }
  }
  async function saveEdit(): Promise<void> {
    const body = text.trim();
    if (!body || !editingId) return;
    setSending(true);
    setSendError(null);
    try {
      await NuruApi.editChatMessage(editingId, body);
      setEditingId(null);
      setText("");
      refreshQueries(queryKeys.chatConvo(conversationId));
      refreshQueries(queryKeys.chatInbox);
      void refetch();
    } catch (e) {
      setSendError(composerError(e));
    } finally {
      setSending(false);
    }
  }

  async function react(messageId: string, emoji: string): Promise<void> {
    try {
      await NuruApi.toggleChatReaction(messageId, emoji);
      void refetch();
    } catch {
      /* best-effort; a failed reaction shouldn't interrupt the conversation */
    }
  }

  function runAttach(fn: () => void): void {
    setShowAttach(false);
    fn();
  }

  // AI in the text box (sparkle): Nuru reads the recent thread and proposes the next
  // message — drafting when empty, polishing when there's a draft. Fills the input
  // for the member to send/edit/dismiss (NEVER auto-sent). Server-authoritative.
  async function aiAssist(): Promise<void> {
    if (aiBusy || !convo) return;
    setShowEmoji(false);
    setShowAttach(false);
    setAiBusy(true);
    setSendError(null);
    try {
      const draft = text.trim();
      const instruction = draft
        ? `Polish my draft reply, keeping my intent — kind, concise, first person, fitting the thread. Reply with ONLY the message:\n\n${draft}`
        : "Suggest the single best next message for me to send — warm, wise, relevant to the last messages, first person, 1–2 sentences.";
      const { reply } = await NuruApi.assistantChat({
        messages: [{ role: "user", text: instruction }],
        conversation_id: conversationId,
        context_limit: 5,
      });
      const clean = (reply ?? "").trim().replace(/^["“]+|["”]+$/g, "").trim();
      if (clean) {
        setAiPrev(text);
        setText(clean);
      }
    } catch (e) {
      setSendError(composerError(e));
    } finally {
      setAiBusy(false);
    }
  }

  function dismissAi(): void {
    setText(aiPrev ?? "");
    setAiPrev(null);
  }

  const myInitials = initials(me?.profile?.full_name) || "ME";
  const showQuickReplies = !recording && text.trim().length === 0 && !editingId && !replyTo;

  return (
    <View style={st.screen}>
      {/* Navy header (gradient + soft gold glow) */}
      <View style={st.header}>
        <GradientBg colors={["#0B1F33", "#0D2742", "#163655"]} />
        <View style={st.headerGlow} />
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => nav.goBack()} style={({ pressed }) => [st.backBtn, pressed && { transform: [{ scale: 0.92 }] }]}>
            <ChevronLeft size={23} color={palette.onNavy} />
          </Pressable>
          <View>
            {convo?.kind === "dm" ? (
              <View style={st.headRing}>
                <View style={st.headRingInner}>
                  <Avatar uri={convo.messages.find((m) => !m.mine)?.author_avatar} name={convo.title ?? route.params.title} size={38} />
                </View>
              </View>
            ) : (
              <View style={[st.headAvatar, { backgroundColor: senderColor(conversationId).name }]}>
                {convo?.kind === "space" ? <Hash size={18} color="#fff" /> : <Users size={18} color="#fff" />}
              </View>
            )}
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
              {group && convo?.kind === "space" ? <Hash size={14} color={palette.goldGlow} /> : null}
              <T variant="heading" tone="onNavy" numberOfLines={1} style={{ flexShrink: 1 }}>
                {convo?.title ?? route.params.title ?? "Conversation"}
              </T>
            </View>
            {convo ? <T variant="micro" style={{ color: "rgba(255,255,255,0.6)", marginTop: 1 }}>{threadSubtitle(convo)}</T> : null}
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Conversation info" onPress={() => nav.navigate("Nuru")} style={({ pressed }) => [st.headTool, pressed && { transform: [{ scale: 0.92 }] }]}>
            <Sparkles size={18} color={palette.goldGlow} />
          </Pressable>
        </View>

        {/* Verse / topic strip (when the room has a topic) */}
        {convo?.topic ? (
          <View style={st.topicStrip}>
            <Info size={13} color={palette.goldGlow} />
            <T variant="caption" style={{ color: "rgba(255,255,255,0.8)", flex: 1 }} numberOfLines={1}>{convo.topic}</T>
          </View>
        ) : null}
      </View>

      {isLoading ? (
        <View style={st.center}><Loading label="Opening…" /></View>
      ) : error || !convo ? (
        <View style={st.center}><ErrorState message={errorMessage(error)} onRetry={() => void refetch()} /></View>
      ) : (
        <>
          <FlatList
            ref={listRef}
            style={{ flex: 1, backgroundColor: CHAT.canvas }}
            data={rows}
            keyExtractor={(r) => r.key}
            contentContainerStyle={{ paddingHorizontal: spacing.base, paddingTop: spacing.base, paddingBottom: spacing.lg }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
            ListHeaderComponent={
              <View style={st.confidence}>
                <T variant="micro" tone="tertiary">🕊️  Held in confidence — speak life here</T>
              </View>
            }
            ListEmptyComponent={
              <T variant="caption" tone="secondary" style={{ textAlign: "center", marginTop: spacing.xl }}>
                No messages yet — say hello 👋
              </T>
            }
            renderItem={({ item }) =>
              item.kind === "divider" ? (
                <DateDivider label={item.label} />
              ) : (
                <Bubble
                  m={item.m}
                  group={!!group}
                  head={item.head}
                  tail={item.tail}
                  playing={playingId === item.m.message_id}
                  onLongPress={() => setActionFor(item.m)}
                  onReact={(e) => void react(item.m.message_id, e)}
                  onPlayVoice={(url) => void toggleVoicePlayback(item.m.message_id, url)}
                  onSeenBy={item.m.mine ? () => void openSeenBy(item.m) : undefined}
                />
              )
            }
          />

          {/* Quick replies */}
          {showQuickReplies ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              style={{ maxHeight: 52, backgroundColor: CHAT.canvas }}
              contentContainerStyle={st.quickRow}
            >
              {QUICK_REPLIES.map((q) => (
                <Pressable
                  key={q}
                  accessibilityRole="button"
                  accessibilityLabel={`Quick reply: ${q}`}
                  onPress={() => setText(q)}
                  style={({ pressed }) => [st.quickChip, pressed && { transform: [{ scale: 0.96 }] }]}
                >
                  <T variant="caption" style={{ color: palette.navy }}>{q}</T>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}

          {/* Reply-quote preview (display-only; see report on the send-reply gap) */}
          {replyTo ? (
            <View style={[st.banner, { borderLeftColor: replyTo.mine ? palette.gold : senderColor(replyTo.author_user_id).name }]}>
              <CornerUpLeft size={14} color={palette.goldLo} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <T variant="micro" style={{ color: palette.goldLo, fontWeight: "800" }}>Replying to {replyTo.mine ? "yourself" : replyTo.author_name}</T>
                <T variant="caption" tone="secondary" numberOfLines={1}>{replyTo.body || "Attachment"}</T>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="Cancel reply" onPress={() => setReplyTo(null)} hitSlop={8}>
                <X size={16} color={palette.ink400} />
              </Pressable>
            </View>
          ) : null}

          {/* Editing banner */}
          {editingId ? (
            <View style={st.banner}>
              <Pencil size={14} color={palette.goldLo} />
              <T variant="caption" tone="secondary" style={{ flex: 1 }}>Editing message</T>
              <Pressable accessibilityRole="button" accessibilityLabel="Cancel edit" onPress={cancelEdit} hitSlop={8}>
                <T variant="caption" style={{ color: palette.goldLo, fontWeight: "800" }}>Cancel</T>
              </Pressable>
            </View>
          ) : null}

          {/* Nuru suggestion banner */}
          {aiPrev !== null ? (
            <View style={st.banner}>
              <Sparkles size={14} color={palette.goldLo} />
              <T variant="caption" tone="secondary" style={{ flex: 1 }}>Nuru suggested this — edit, send, or</T>
              <Pressable accessibilityRole="button" accessibilityLabel="Dismiss suggestion" onPress={dismissAi} hitSlop={8}>
                <T variant="caption" style={{ color: palette.goldLo, fontWeight: "800" }}>Dismiss</T>
              </Pressable>
            </View>
          ) : null}

          <View style={[st.composer, { marginBottom: kbHeight }]}>
            {recording ? (
              <View style={st.recordRow}>
                <View style={st.recDot} />
                <T variant="body" style={{ color: palette.error, flex: 1, fontWeight: "700" }}>{formatMillis(recordMs)}</T>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Cancel recording"
                  onPress={() => void cancelRecording()}
                  style={({ pressed }) => [st.recCancel, pressed && { transform: [{ scale: 0.95 }] }]}
                >
                  <Trash2 size={18} color={palette.ink400} />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Stop and send voice note"
                  onPress={() => void stopAndSendRecording()}
                  style={({ pressed }) => [st.recStop, pressed && { transform: [{ scale: 0.95 }] }]}
                >
                  <Square size={16} color="#fff" fill="#fff" />
                </Pressable>
              </View>
            ) : (
              <>
                {/* "+" attachment grid */}
                {showAttach ? (
                  <View style={st.attachPanel}>
                    <View style={st.attachGrid}>
                      <AttachTile color="#16A34A" Icon={ImagePlus} label="Photo" onPress={() => runAttach(() => void attachMedia("photo"))} />
                      <AttachTile color="#DC2626" Icon={Video} label="Video" onPress={() => runAttach(() => void attachMedia("video"))} />
                      <AttachTile color="#0B1F33" Icon={Camera} label="Camera" onPress={() => runAttach(() => void attachMedia("photo", true))} />
                      <AttachTile color="#0EA5E9" Icon={Paperclip} label="File" onPress={() => runAttach(() => void attachFile())} />
                      <AttachTile color="#7C3AED" Icon={FileText} label="Document" onPress={() => runAttach(() => void attachFile())} />
                      <AttachTile color="#DB2777" Icon={Mic} label="Audio" onPress={() => runAttach(() => void startRecording())} />
                    </View>
                  </View>
                ) : null}

                {/* Emoji strip */}
                {showEmoji && !showAttach ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={{ maxHeight: 48 }} contentContainerStyle={st.emojiStrip}>
                    {EMOJIS.map((e) => (
                      <Pressable key={e} accessibilityRole="button" accessibilityLabel={`Insert ${e}`} onPress={() => setText((t) => t + e)} style={({ pressed }) => [st.emojiKey, pressed && { transform: [{ scale: 0.9 }] }]}>
                        <T style={{ fontSize: 24 }}>{e}</T>
                      </Pressable>
                    ))}
                  </ScrollView>
                ) : null}

                {sendError ? <T variant="caption" style={{ color: palette.error, marginBottom: 6, marginLeft: 52 }}>{sendError}</T> : null}

                <View style={st.composerRow}>
                  <View style={st.composerAvatar}>
                    <T variant="heading" style={{ color: "#fff", fontSize: 13 }}>{myInitials}</T>
                  </View>

                  {/* Rounded input pill: + · text · AI · emoji */}
                  <View style={[st.inputPill, aiBusy && { borderColor: "rgba(201,162,39,0.5)" }]}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={showAttach ? "Close attachments" : "Add attachment"}
                      onPress={() => { setShowEmoji(false); setShowAttach((v) => !v); }}
                      style={({ pressed }) => [showAttach ? st.plusOpen : st.plusBtn, pressed && { opacity: 0.7 }]}
                    >
                      {showAttach ? <X size={18} color={palette.goldLo} /> : <Plus size={22} color={palette.ink400} />}
                    </Pressable>
                    <TextInput
                      value={text}
                      onChangeText={(t) => { setText(t); if (aiPrev !== null) setAiPrev(null); }}
                      onFocus={() => { setShowAttach(false); setShowEmoji(false); }}
                      placeholder={aiBusy ? "Nuru is drafting…" : editingId ? "Edit your message…" : "Message"}
                      placeholderTextColor={palette.ink400}
                      accessibilityLabel="Message"
                      multiline
                      style={st.inputFlex}
                    />
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Nuru AI — draft or polish this message"
                      onPress={() => void aiAssist()}
                      disabled={aiBusy}
                      style={({ pressed }) => [st.aiBtn, pressed && { transform: [{ scale: 0.92 }] }]}
                    >
                      {aiBusy ? <ActivityIndicator size="small" color={palette.goldLo} /> : <Sparkles size={17} color={palette.goldLo} />}
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Emoji"
                      onPress={() => { setShowAttach(false); setShowEmoji((v) => !v); }}
                      style={({ pressed }) => [st.emojiBtn, pressed && { transform: [{ scale: 0.92 }] }]}
                    >
                      <Smile size={20} color={palette.ink400} />
                    </Pressable>
                  </View>

                  {/* Save (edit) · Send (text) · Record (voice) — gold gradient */}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={editingId ? "Save edit" : text.trim().length > 0 ? "Send" : "Record voice note"}
                    onPress={() => (editingId ? void saveEdit() : text.trim().length > 0 ? void send() : void startRecording())}
                    disabled={sending}
                    style={({ pressed }) => [st.sendBtn, pressed && { transform: [{ scale: 0.92 }] }]}
                  >
                    <GradientBg colors={[palette.goldHi, palette.gold, "#B07D2E"]} radius={24} />
                    {editingId ? <SendHorizontal size={20} color="#fff" /> : text.trim().length > 0 ? <SendHorizontal size={20} color="#fff" /> : <Mic size={20} color="#fff" />}
                  </Pressable>
                </View>
              </>
            )}
          </View>
        </>
      )}

      {/* Long-press action sheet: reply / copy / forward / star / edit / delete */}
      <ActionSheet
        message={actionFor}
        onClose={() => setActionFor(null)}
        onReact={(m, e) => { setActionFor(null); void react(m.message_id, e); }}
        onReply={(m) => { setActionFor(null); setReplyTo(m); setEditingId(null); }}
        onCopy={(m) => { setActionFor(null); Clipboard.setString(m.body); }}
        onEdit={(m) => { setActionFor(null); setEditingId(m.message_id); setText(m.body); setAiPrev(null); setReplyTo(null); }}
        onDelete={(m) => { setActionFor(null); confirmDelete(m.message_id); }}
      />

      {/* Seen-by sheet (the "eye") — who has read this message. */}
      <Modal visible={!!seenBy} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setSeenBy(null)}>
        <Pressable style={st.sheetScrim} accessibilityRole="button" accessibilityLabel="Close" onPress={() => setSeenBy(null)} />
        <View style={st.seenSheet}>
          <View style={st.sheetGrip} />
          <T variant="heading" style={{ marginBottom: 2 }}>Seen by</T>
          {seenBy ? (
            <T variant="caption" tone="tertiary" style={{ marginBottom: spacing.sm }}>
              {`${seenBy.data?.read_count ?? seenBy.msg.read_count} of ${seenBy.data?.recipient_count ?? seenBy.msg.recipient_count} read`}
            </T>
          ) : null}
          {!seenBy?.data ? (
            <ActivityIndicator color={palette.gold} style={{ marginVertical: spacing.lg }} />
          ) : seenBy.data.readers.length === 0 ? (
            <T variant="caption" tone="secondary" style={{ marginVertical: spacing.md }}>No one has read this yet.</T>
          ) : (
            <ScrollView style={{ maxHeight: 320 }}>
              {seenBy.data.readers.map((r) => (
                <View key={r.user_id} style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm }}>
                  <Avatar uri={r.avatar_url} name={r.full_name} size={36} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <T variant="caption" style={{ fontWeight: "700", color: palette.ink }} numberOfLines={1}>{r.full_name}</T>
                    {r.read_at ? <T variant="micro" tone="tertiary">{when(r.read_at)}</T> : null}
                  </View>
                  <ReadTicks state="read" />
                </View>
              ))}
            </ScrollView>
          )}
        </View>
      </Modal>
    </View>
  );
}

/** Long-press action sheet (bottom sheet) with a quick-reaction row on top. */
function ActionSheet({
  message,
  onClose,
  onReact,
  onReply,
  onCopy,
  onEdit,
  onDelete,
}: {
  message: ChatMessage | null;
  onClose: () => void;
  onReact: (m: ChatMessage, e: string) => void;
  onReply: (m: ChatMessage) => void;
  onCopy: (m: ChatMessage) => void;
  onEdit: (m: ChatMessage) => void;
  onDelete: (m: ChatMessage) => void;
}): ReactElement {
  const m = message;
  const mine = !!m?.mine;
  const actions: { id: string; label: string; Icon: typeof Copy; onPress: () => void; danger?: boolean }[] = m
    ? [
        { id: "reply", label: "Reply", Icon: CornerUpLeft, onPress: () => onReply(m) },
        { id: "copy", label: "Copy", Icon: Copy, onPress: () => onCopy(m) },
        { id: "forward", label: "Forward", Icon: Forward, onPress: onClose },
        ...(mine
          ? [
              { id: "edit", label: "Edit", Icon: Pencil, onPress: () => onEdit(m) },
              { id: "delete", label: "Delete", Icon: Trash2, onPress: () => onDelete(m), danger: true },
            ]
          : [{ id: "star", label: "Star", Icon: Star, onPress: onClose }]),
      ]
    : [];
  return (
    <Modal visible={!!m} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <Pressable style={st.sheetScrim} accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} />
      <View style={st.actionSheet}>
        <View style={st.sheetGrip} />
        {/* Quick reaction pill */}
        <View style={st.reactPill}>
          {QUICK_REACTIONS.map((e) => {
            const active = m?.reactions.some((r) => r.emoji === e && r.mine);
            return (
              <Pressable
                key={e}
                accessibilityRole="button"
                accessibilityLabel={`React ${e}`}
                onPress={() => m && onReact(m, e)}
                style={({ pressed }) => [st.reactPick, active && st.reactPickActive, pressed && { transform: [{ scale: 1.2 }] }]}
              >
                <T style={{ fontSize: 24 }}>{e}</T>
              </Pressable>
            );
          })}
        </View>
        {/* Actions */}
        <View style={st.actionList}>
          {actions.map((a, i) => (
            <Pressable
              key={a.id}
              accessibilityRole="button"
              accessibilityLabel={a.label}
              onPress={a.onPress}
              style={({ pressed }) => [st.actionRow, i > 0 && st.actionDivider, pressed && { backgroundColor: palette.surface }]}
            >
              <T variant="body" style={{ flex: 1, color: a.danger ? palette.error : palette.navy, fontWeight: "500" }}>{a.label}</T>
              <a.Icon size={18} color={a.danger ? palette.error : palette.navy} />
            </Pressable>
          ))}
        </View>
      </View>
    </Modal>
  );
}

/** One tile in the "+" attachment grid (Photo/Video/Camera/File/Document/Audio). */
function AttachTile({ color, Icon, label, onPress }: { color: string; Icon: typeof Mic; label: string; onPress: () => void }): ReactElement {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [st.attachTile, pressed && { transform: [{ scale: 0.96 }] }]}>
      <View style={[st.attachTileIcon, { backgroundColor: color }]}><Icon size={22} color="#fff" /></View>
      <T variant="caption" style={{ color: palette.navy, fontWeight: "600" }}>{label}</T>
    </Pressable>
  );
}

/** A soft floating message bubble (no tail) in the Aurora style. */
function Bubble({
  m,
  group,
  head,
  tail,
  playing,
  onLongPress,
  onReact,
  onPlayVoice,
  onSeenBy,
}: {
  m: ChatMessage;
  group: boolean;
  head: boolean;
  tail: boolean;
  playing: boolean;
  onLongPress: () => void;
  onReact: (emoji: string) => void;
  onPlayVoice: (url: string) => void;
  onSeenBy?: (() => void) | undefined;
}): ReactElement {
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(enter, { toValue: 1, damping: 16, stiffness: 320, useNativeDriver: true }).start();
  }, [enter]);

  const meta = (m.attachment_meta ?? {}) as { duration?: number; name?: string; size?: number };
  const [videoOpen, setVideoOpen] = useState(false);
  const accent = senderColor(m.author_user_id).name;
  const recipients = m.recipient_count ?? 0;
  const reads = m.read_count ?? 0;
  const readState: "sent" | "delivered" | "read" = recipients > 0 && reads >= recipients ? "read" : reads > 0 ? "delivered" : "sent";
  const showName = group && !m.mine && head;
  const textColor = m.mine ? "#fff" : CHAT.bubbleText;
  const metaColor = m.mine ? "rgba(255,255,255,0.6)" : CHAT.meta;
  const chipColor = m.mine ? "#fff" : palette.navy;

  const translateY = enter.interpolate({ inputRange: [0, 1], outputRange: [8, 0] });

  return (
    <Animated.View
      style={[
        { flexDirection: "row", alignItems: "flex-end", gap: spacing.xs, marginBottom: tail ? spacing.md : 3, opacity: enter, transform: [{ translateY }] },
        m.mine ? { justifyContent: "flex-end" } : { justifyContent: "flex-start" },
      ]}
    >
      {/* Avatar for incoming, once at the bottom of a run */}
      {!m.mine ? <View style={{ width: 28 }}>{tail ? <Avatar uri={m.author_avatar} name={m.author_name} size={28} /> : null}</View> : null}

      <View style={{ maxWidth: "80%", alignItems: m.mine ? "flex-end" : "flex-start", flexShrink: 1, minWidth: 0 }}>
        {/* AI tag */}
        {m.ai_tag ? (
          <View style={[st.aiTagPill, m.mine ? { alignSelf: "flex-end" } : { alignSelf: "flex-start" }]}>
            <Sparkles size={9} color={palette.goldLo} />
            <T variant="micro" style={{ color: palette.goldLo, fontWeight: "800", letterSpacing: 0.5 }}>{m.ai_tag.toUpperCase()}</T>
          </View>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Message — long-press for actions"
          onLongPress={onLongPress}
          delayLongPress={250}
          style={[st.bubble, { borderBottomRightRadius: m.mine && tail ? 8 : 22, borderBottomLeftRadius: !m.mine && tail ? 8 : 22 }]}
        >
          {m.mine ? <GradientBg colors={[palette.navy, "#163655"]} radius={22} /> : null}
          {!m.mine ? <View style={st.bubbleLightFill} /> : null}

          {/* Sender name (groups) */}
          {showName ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 3 }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: accent }} />
              <T variant="caption" style={{ color: accent, fontWeight: "800" }}>{m.author_name}</T>
            </View>
          ) : null}

          {/* Reply quote */}
          {m.reply_body ? (
            <View style={[st.quote, { borderLeftColor: m.mine ? palette.goldGlow : accent }]}>
              <T variant="micro" style={{ color: m.mine ? palette.goldGlow : accent, fontWeight: "800" }} numberOfLines={1}>{m.reply_author ?? "Reply"}</T>
              <T variant="caption" style={{ color: m.mine ? "rgba(255,255,255,0.75)" : palette.ink600 }} numberOfLines={2}>{m.reply_body}</T>
            </View>
          ) : null}

          {/* Attachment is the main content; body becomes the caption */}
          {m.msg_type === "image" && m.attachment_url ? (
            <AttachmentImage url={m.attachment_url} />
          ) : m.msg_type === "video" && m.attachment_url ? (
            videoOpen ? (
              <View style={{ width: 244, maxWidth: "100%", marginBottom: m.body ? 6 : 0 }}>
                <VideoPlayer uri={m.attachment_url} height={150} radius={12} />
              </View>
            ) : (
              <Pressable accessibilityRole="button" accessibilityLabel="Play video" onPress={() => setVideoOpen(true)} style={st.mediaChip}>
                <View style={[st.playDot, { backgroundColor: m.mine ? "rgba(255,255,255,0.18)" : "rgba(201,162,39,0.16)" }]}><Play size={13} color={chipColor} /></View>
                <T variant="caption" style={{ color: textColor }}>Play video</T>
              </Pressable>
            )
          ) : m.msg_type === "voice" && m.attachment_url ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={playing ? "Stop voice message" : "Play voice message"}
              onPress={() => onPlayVoice(m.attachment_url as string)}
              style={st.voiceRow}
            >
              <View style={[st.playDot, { backgroundColor: m.mine ? "rgba(255,255,255,0.18)" : "rgba(201,162,39,0.16)" }]}>
                {playing ? <Pause size={14} color={chipColor} /> : <Play size={14} color={chipColor} />}
              </View>
              <Waveform color={m.mine ? "#fff" : palette.gold} dimColor={m.mine ? "rgba(255,255,255,0.4)" : "rgba(201,162,39,0.5)"} progress={playing ? 0.4 : 0} />
              <T variant="micro" style={{ color: metaColor }}>{voiceLabel(meta.duration).replace("Voice message · ", "")}</T>
            </Pressable>
          ) : m.msg_type === "voice" ? (
            <View style={st.mediaChip}><Play size={14} color={chipColor} /><T variant="caption" style={{ color: textColor }}>Voice message</T></View>
          ) : m.msg_type === "file" && m.attachment_url ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Open ${fileLabel(meta.name)}`}
              onPress={() => void Linking.openURL(m.attachment_url as string).catch(() => undefined)}
              style={[st.fileChip, { backgroundColor: m.mine ? "rgba(255,255,255,0.12)" : CHAT.quoteBg, marginBottom: m.body ? 6 : 0 }]}
            >
              <View style={st.fileIcon}><FileText size={18} color={palette.gold} /></View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <T variant="caption" style={{ color: textColor, fontWeight: "600" }} numberOfLines={1}>{fileLabel(meta.name)}</T>
                {formatBytes(meta.size) ? <T variant="micro" style={{ color: metaColor }}>{formatBytes(meta.size)}</T> : null}
              </View>
            </Pressable>
          ) : null}

          {/* Body / caption */}
          {m.body ? <T variant="body" style={{ color: textColor, marginTop: m.msg_type !== "text" ? 4 : 0 }}>{m.body}</T> : null}

          {/* Meta row: edited · time · ticks */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-end", marginTop: 4 }}>
            {m.is_edited ? <T variant="micro" style={{ color: metaColor, fontStyle: "italic" }}>edited</T> : null}
            <T variant="micro" style={{ color: metaColor }}>{when(m.created_at)}</T>
            {m.mine ? <ReadTicks state={readState} /> : null}
          </View>
        </Pressable>

        {/* Existing reactions (tap to toggle) */}
        {m.reactions.length > 0 ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
            {m.reactions.map((r) => (
              <Pressable key={r.emoji} accessibilityRole="button" accessibilityLabel={`${r.emoji} ${r.count}`} onPress={() => onReact(r.emoji)} style={[st.reaction, r.mine && st.reactionMine]}>
                <T style={{ fontSize: 12 }}>{r.emoji}</T>
                <T variant="micro" style={{ color: palette.navy, fontWeight: "700" }}>{r.count}</T>
              </Pressable>
            ))}
          </View>
        ) : null}

        {/* Group read tally (mine, multi-recipient, not all read yet) */}
        {m.mine && recipients > 1 && readState !== "read" && onSeenBy ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Seen by" onPress={onSeenBy} hitSlop={6} style={{ marginTop: 3 }}>
            <T variant="micro" tone="tertiary">{`${reads} read · ${recipients - reads} waiting`}</T>
          </Pressable>
        ) : m.mine && recipients === 1 && readState !== "read" && onSeenBy ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Seen by" onPress={onSeenBy} hitSlop={6} style={{ marginTop: 3 }}>
            <T variant="micro" tone="tertiary">Delivered</T>
          </Pressable>
        ) : null}
      </View>
    </Animated.View>
  );
}

/** Renders a chat image from its Cloudinary secure URL — full (no crop). Tapping
 *  opens a full-screen viewer; tap anywhere or ✕ to go back. */
function AttachmentImage({ url }: { url: string }): ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable accessibilityRole="imagebutton" accessibilityLabel="Shared photo, tap to view" onPress={() => setOpen(true)} style={st.imageWrap}>
        <FitImage uri={url} radius={14} maxHeight={300} />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setOpen(false)}>
        <Pressable style={st.viewerRoot} accessibilityRole="button" accessibilityLabel="Close photo" onPress={() => setOpen(false)}>
          <Image source={{ uri: cdnImage(url) }} style={st.viewerImg} resizeMode="contain" />
          <View style={st.viewerClose}><X size={24} color="#fff" /></View>
        </Pressable>
      </Modal>
    </>
  );
}


const st = {
  screen: { flex: 1, backgroundColor: CHAT.canvas },
  header: { paddingTop: 54, paddingBottom: spacing.md, paddingHorizontal: spacing.base, overflow: "hidden", borderBottomLeftRadius: 26, borderBottomRightRadius: 26 },
  headerGlow: { position: "absolute", right: -48, top: -64, width: 176, height: 176, borderRadius: 88, backgroundColor: "rgba(201,162,39,0.22)" },
  backBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  headAvatar: { width: 40, height: 40, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  headRing: { width: 44, height: 44, borderRadius: 15, padding: 2, backgroundColor: palette.gold, alignItems: "center", justifyContent: "center" },
  headRingInner: { borderRadius: 13, padding: 1.5, backgroundColor: palette.navy },
  headTool: { width: 36, height: 36, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.08)", borderWidth: 1, borderColor: "rgba(255,255,255,0.10)", alignItems: "center", justifyContent: "center" },
  topicStrip: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.md, backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 16, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderWidth: 1, borderColor: "rgba(255,255,255,0.10)" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: CHAT.canvas },
  confidence: { alignItems: "center", marginBottom: spacing.base },

  // Bubbles
  bubble: { overflow: "hidden", borderRadius: 22, paddingHorizontal: spacing.base, paddingVertical: 10, ...shadow.card },
  bubbleLightFill: { ...{ position: "absolute" as const, top: 0, left: 0, right: 0, bottom: 0 }, backgroundColor: CHAT.incoming, borderRadius: 22, borderWidth: 1, borderColor: CHAT.bubbleBorder },
  aiTagPill: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(201,162,39,0.14)", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, marginBottom: 4 },
  quote: { borderLeftWidth: 3, borderRadius: 10, paddingVertical: 4, paddingLeft: 8, paddingRight: 8, marginBottom: 6, backgroundColor: "rgba(11,31,51,0.05)" },
  mediaChip: { flexDirection: "row", alignItems: "center", gap: 8 },
  voiceRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 2 },
  playDot: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  fileChip: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 12, padding: 8 },
  fileIcon: { width: 34, height: 34, borderRadius: 9, backgroundColor: "rgba(201,162,39,0.16)", alignItems: "center", justifyContent: "center" },
  imageWrap: { width: 240, marginBottom: 2 },
  reaction: { flexDirection: "row", alignItems: "center", gap: 3, borderWidth: 1, borderColor: palette.border, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, backgroundColor: palette.white },
  reactionMine: { borderColor: palette.gold, backgroundColor: "rgba(201,162,39,0.14)" },

  // Quick replies + banners
  quickRow: { gap: spacing.sm, paddingHorizontal: spacing.base, paddingVertical: spacing.sm },
  quickChip: { backgroundColor: palette.white, borderRadius: radii.pill, borderWidth: 1, borderColor: palette.border, paddingHorizontal: spacing.base, height: 38, alignItems: "center", justifyContent: "center", ...shadow.card },
  banner: { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: spacing.base, marginBottom: spacing.sm, backgroundColor: palette.white, borderRadius: 14, borderWidth: 1, borderColor: palette.border, borderLeftWidth: 3, borderLeftColor: palette.gold, paddingHorizontal: spacing.md, paddingVertical: 8 },

  // Composer
  composer: { backgroundColor: "rgba(255,255,255,0.96)", borderTopWidth: 1, borderTopColor: palette.border, paddingHorizontal: spacing.base, paddingTop: spacing.md, paddingBottom: spacing.lg },
  composerRow: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm },
  composerAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: palette.navy, alignItems: "center", justifyContent: "center", marginBottom: 6 },
  inputPill: { flex: 1, flexDirection: "row", alignItems: "center", gap: 2, backgroundColor: palette.paper, borderRadius: 26, borderWidth: 1, borderColor: palette.border, paddingLeft: 6, paddingRight: 8, minHeight: 48 },
  plusBtn: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  plusOpen: { width: 34, height: 34, borderRadius: 12, borderWidth: 1.5, borderColor: "rgba(201,162,39,0.6)", backgroundColor: palette.goldTint, alignItems: "center", justifyContent: "center" },
  inputFlex: { flex: 1, paddingVertical: Platform.OS === "ios" ? 12 : 6, paddingHorizontal: 4, maxHeight: 120, fontSize: 16, color: palette.ink, textAlignVertical: "center" },
  aiBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: palette.goldTint, alignItems: "center", justifyContent: "center" },
  emojiBtn: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  sendBtn: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", overflow: "hidden", marginBottom: 0, ...shadow.card },

  // Attachment grid + emoji strip
  attachPanel: { backgroundColor: palette.white, borderRadius: 20, borderWidth: 1, borderColor: palette.border, padding: spacing.base, marginBottom: spacing.md, ...shadow.card },
  attachGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: spacing.base },
  attachTile: { width: "31%", alignItems: "center", gap: 8, paddingVertical: spacing.sm, borderRadius: 16, backgroundColor: palette.surface },
  attachTileIcon: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center" },
  emojiStrip: { gap: spacing.sm, paddingHorizontal: 52, paddingVertical: spacing.sm, alignItems: "center" },
  emojiKey: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },

  // Recorder
  recordRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm },
  recDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: palette.error },
  recCancel: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.paper, alignItems: "center", justifyContent: "center" },
  recStop: { width: 46, height: 46, borderRadius: 23, backgroundColor: palette.error, alignItems: "center", justifyContent: "center" },

  // Sheets
  sheetScrim: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(11,31,51,0.4)" },
  actionSheet: { position: "absolute", left: spacing.base, right: spacing.base, bottom: spacing.lg, backgroundColor: "transparent" },
  reactPill: { flexDirection: "row", alignItems: "center", justifyContent: "space-around", backgroundColor: palette.white, borderRadius: radii.pill, paddingVertical: 8, paddingHorizontal: spacing.sm, marginBottom: spacing.sm, ...shadow.card },
  reactPick: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  reactPickActive: { backgroundColor: "rgba(201,162,39,0.18)" },
  actionList: { backgroundColor: palette.white, borderRadius: 20, overflow: "hidden", ...shadow.card },
  actionRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.base },
  actionDivider: { borderTopWidth: 1, borderTopColor: palette.border },
  seenSheet: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: palette.white, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: spacing.lg, paddingBottom: spacing.xxl },
  sheetGrip: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: palette.border, marginBottom: spacing.base },

  // Image viewer
  viewerRoot: { flex: 1, backgroundColor: "rgba(0,0,0,0.96)", alignItems: "center", justifyContent: "center" },
  viewerImg: { width: "100%", height: "100%" },
  viewerClose: { position: "absolute", top: 54, right: 20, width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(255,255,255,0.16)", alignItems: "center", justifyContent: "center" },
} as const;
