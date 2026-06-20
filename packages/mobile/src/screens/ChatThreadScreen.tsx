// Chat thread (new design, mobile "Chat" make). The conversation view for a DM,
// cell group, or space: messages with author + reactions, a composer, and a
// react affordance. Sends go through writeThrough — online they post immediately,
// offline they queue (chat_messages:create) and replay on reconnect (§1.7).
// Opening the thread marks it read.
import { useEffect, useRef, useState, type ReactElement } from "react";
import { Image, Keyboard, Linking, PermissionsAndroid, Platform, Pressable, ScrollView, TextInput, View } from "react-native";
import { launchImageLibrary } from "react-native-image-picker";
import AudioRecorderPlayer from "react-native-audio-recorder-player";
import { pick as pickDocument, isCancel } from "react-native-document-picker";
import { ArrowLeft, FileText, Hash, ImagePlus, Mic, Paperclip, Play, Square, Users, Video } from "lucide-react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { RootStackParamList } from "../navigation/types";
import type { ChatMessage } from "../api/types";
import { NuruApi } from "../api/client";
import { uuidv4 } from "../util/uuid";
import { palette, radii, spacing, shadow } from "../theme/tokens";
import { PButton, T } from "../theme/components";
import { useChatConversation, queryKeys } from "../api/hooks";
import { errorMessage, refreshQueries } from "../api/query";
import { writeThrough } from "../sync/offlineWrite";
import { getSyncEngine } from "../sync/engineProvider";
import { getConnectivity } from "../net/connectivity";
import { Loading, ErrorState } from "../components/states";
import {
  formatMillis,
  voiceFileName,
  voiceAttachmentMeta,
  fileAttachmentMeta,
  voiceLabel,
  fileLabel,
  formatBytes,
} from "./chatMediaHelpers";

const QUICK = ["🙏", "❤️", "🔥", "🎉"];

// react-native-audio-recorder-player v4 exports a singleton instance (no `new`).
const recorder = AudioRecorderPlayer;

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
  const [recording, setRecording] = useState(false);
  const [recordMs, setRecordMs] = useState(0);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const recordingPath = useRef<string | null>(null);
  const recordDurationMs = useRef(0);
  const scrollRef = useRef<ScrollView>(null);

  // Lift the composer above the on-screen keyboard (same approach as the Profile
  // sheets): track the keyboard height and add it as bottom margin so the input
  // stays visible; the flex:1 message list shrinks to fill the space above it.
  const [kbHeight, setKbHeight] = useState(0);
  useEffect(() => {
    const showEvt = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvt = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const show = Keyboard.addListener(showEvt, (e) => {
      setKbHeight(e.endCoordinates?.height ?? 0);
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    });
    const hide = Keyboard.addListener(hideEvt, () => setKbHeight(0));
    return () => { show.remove(); hide.remove(); };
  }, []);

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
      const payload = { conversation_id: conversationId, message_id: uuidv4(), body, client_mutation_id: uuidv4() };
      await writeThrough({
        engine: getSyncEngine(),
        connectivity: getConnectivity(),
        online: () => NuruApi.sendChatMessage(conversationId, { message_id: payload.message_id, body, client_mutation_id: payload.client_mutation_id }),
        queued: { domain: "chat_messages", op: "create", payload },
      });
      setText("");
      refreshQueries(queryKeys.chatConvo(conversationId));
      refreshQueries(queryKeys.chatInbox);
      void refetch();
    } catch (e) {
      setSendError(errorMessage(e));
    } finally {
      setSending(false);
    }
  }

  function attachImage(): void {
    void attachMedia("photo");
  }

  // Photo + video share react-native-image-picker; voice notes use
  // react-native-audio-recorder-player and files use react-native-document-picker
  // (see startRecording/attachFile below). All upload direct, never queued (§4.5).
  async function attachMedia(mode: "photo" | "video"): Promise<void> {
    // Media requires connectivity — bytes upload direct to storage, not queued (§4.5).
    if (!(await getConnectivity().isOnline())) {
      setSendError(`You're offline — ${mode === "video" ? "videos" : "images"} need a connection.`);
      return;
    }
    const result = await launchImageLibrary({ mediaType: mode, quality: 0.8, selectionLimit: 1 });
    const asset = result.assets?.[0];
    if (!asset?.uri) return; // cancelled
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
      setSendError(errorMessage(e));
    } finally {
      setSending(false);
    }
  }

  // ---- Voice notes (native recorder; bytes upload direct, never queued §4.5) ----
  async function requestMicPermission(): Promise<boolean> {
    if (Platform.OS !== "android") return true; // iOS prompts on first record
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
      setSendError(errorMessage(e));
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
      setSendError(errorMessage(e));
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
      setSendError(errorMessage(e));
    } finally {
      setSending(false);
    }
  }

  // Tap a received voice bubble to play; tap again (or another) to stop.
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
      if (!first) return; // cancelled / empty
      picked = first;
    } catch (e) {
      if (isCancel(e)) return; // user dismissed the picker
      setSendError(errorMessage(e));
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
              <Bubble
                key={m.message_id}
                m={m}
                onLongPress={() => setReactingId(m.message_id)}
                reacting={reactingId === m.message_id}
                onReact={(e) => void react(m.message_id, e)}
                playing={playingId === m.message_id}
                onPlayVoice={(url) => void toggleVoicePlayback(m.message_id, url)}
              />
            ))}
            {convo.messages.length === 0 ? (
              <T variant="caption" tone="secondary" style={{ textAlign: "center", marginTop: spacing.xl }}>
                No messages yet — say hello 👋
              </T>
            ) : null}
          </ScrollView>

          <View style={[st.composer, { marginBottom: kbHeight }]}>
            {recording ? (
              <View style={st.recordRow}>
                <View style={st.recDot} />
                <T variant="body" style={{ color: palette.ink, flex: 1 }}>Recording… {formatMillis(recordMs)}</T>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Cancel recording"
                  onPress={() => void cancelRecording()}
                  style={({ pressed }) => [st.recCancel, pressed && { transform: [{ scale: 0.95 }] }]}
                >
                  <T variant="caption" style={{ color: palette.ink600 }}>Cancel</T>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Stop and send voice note"
                  onPress={() => void stopAndSendRecording()}
                  style={({ pressed }) => [st.recStop, pressed && { transform: [{ scale: 0.95 }] }]}
                >
                  <Square size={16} color={palette.onNavy} fill={palette.onNavy} />
                </Pressable>
              </View>
            ) : (
              <>
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
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Add video"
                    onPress={() => void attachMedia("video")}
                    disabled={sending}
                    style={({ pressed }) => [st.attachBtn, pressed && { transform: [{ scale: 0.95 }] }]}
                  >
                    <Video size={20} color={palette.navy} />
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Attach file"
                    onPress={() => void attachFile()}
                    disabled={sending}
                    style={({ pressed }) => [st.attachBtn, pressed && { transform: [{ scale: 0.95 }] }]}
                  >
                    <Paperclip size={20} color={palette.navy} />
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Record voice note"
                    onPress={() => void startRecording()}
                    disabled={sending}
                    style={({ pressed }) => [st.attachBtn, pressed && { transform: [{ scale: 0.95 }] }]}
                  >
                    <Mic size={20} color={palette.navy} />
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
              </>
            )}
          </View>
        </>
      )}
    </View>
  );
}

function Bubble({
  m,
  onLongPress,
  reacting,
  onReact,
  playing,
  onPlayVoice,
}: {
  m: ChatMessage;
  onLongPress: () => void;
  reacting: boolean;
  onReact: (emoji: string) => void;
  playing: boolean;
  onPlayVoice: (url: string) => void;
}): ReactElement {
  const meta = (m.attachment_meta ?? {}) as { duration?: number; name?: string; size?: number };
  const chipColor = m.mine ? palette.onNavy : palette.navy;
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
          <AttachmentImage url={m.attachment_url} />
        ) : m.msg_type === "voice" && m.attachment_url ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={playing ? "Stop voice message" : "Play voice message"}
            onPress={() => onPlayVoice(m.attachment_url as string)}
            style={st.mediaChip}
          >
            {playing ? <Square size={14} color={chipColor} fill={chipColor} /> : <Play size={14} color={chipColor} />}
            <T variant="caption" style={{ color: m.mine ? "#fff" : palette.ink }}>{voiceLabel(meta.duration)}</T>
          </Pressable>
        ) : m.msg_type === "voice" ? (
          <View style={st.mediaChip}><Play size={14} color={chipColor} /><T variant="caption" style={{ color: m.mine ? "#fff" : palette.ink }}>Voice message</T></View>
        ) : m.msg_type === "file" && m.attachment_url ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open ${fileLabel(meta.name)}`}
            onPress={() => void Linking.openURL(m.attachment_url as string).catch(() => undefined)}
            style={st.mediaChip}
          >
            <FileText size={14} color={chipColor} />
            <T variant="caption" style={{ color: m.mine ? "#fff" : palette.ink }} numberOfLines={1}>
              {fileLabel(meta.name)}{formatBytes(meta.size) ? ` · ${formatBytes(meta.size)}` : ""}
            </T>
          </Pressable>
        ) : m.msg_type === "video" && m.attachment_url ? (
          <View style={st.mediaChip}><Play size={14} color={chipColor} /><T variant="caption" style={{ color: m.mine ? "#fff" : palette.ink }}>Video</T></View>
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

/** Renders a chat image from its Cloudinary secure URL (delivered direct, no resolve step). */
function AttachmentImage({ url }: { url: string }): ReactElement {
  const [failed, setFailed] = useState(false);
  if (failed) return <View style={st.imageBox}><T variant="caption" tone="tertiary">Image unavailable</T></View>;
  return (
    <Image
      source={{ uri: url }}
      style={st.image}
      resizeMode="cover"
      accessibilityLabel="Shared photo"
      onError={() => setFailed(true)}
    />
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
  attachBtn: { width: 46, height: 46, borderRadius: 23, backgroundColor: palette.coolPaper, borderWidth: 1, borderColor: palette.border, alignItems: "center", justifyContent: "center" },
  image: { width: 220, height: 220, borderRadius: 14, marginBottom: 2 },
  imageBox: { width: 220, height: 220, borderRadius: 14, backgroundColor: "rgba(11,31,51,0.06)", alignItems: "center", justifyContent: "center", marginBottom: 2 },
  mediaChip: { flexDirection: "row", alignItems: "center", gap: 6, maxWidth: 240 },
  recordRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm },
  recDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: palette.error },
  recCancel: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radii.control, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.coolPaper },
  recStop: { width: 46, height: 46, borderRadius: 23, backgroundColor: palette.navy, alignItems: "center", justifyContent: "center" },
  composer: {
    borderTopWidth: 1, borderTopColor: palette.border, backgroundColor: palette.white,
    paddingHorizontal: spacing.screen, paddingTop: spacing.md, paddingBottom: spacing.lg,
  },
  input: {
    backgroundColor: palette.coolPaper, borderRadius: radii.control, borderWidth: 1, borderColor: palette.border,
    paddingHorizontal: spacing.base, paddingTop: spacing.md, minHeight: 48, maxHeight: 120, fontSize: 15, color: palette.ink, textAlignVertical: "top",
  },
} as const;
