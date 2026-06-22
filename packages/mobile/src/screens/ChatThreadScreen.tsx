// Chat thread (new design, mobile "Chat" make). The conversation view for a DM,
// cell group, or space: messages with author + reactions, a composer, and a
// react affordance. Sends go through writeThrough — online they post immediately,
// offline they queue (chat_messages:create) and replay on reconnect (§1.7).
// Opening the thread marks it read.
import { useEffect, useRef, useState, type ReactElement } from "react";
import { ActivityIndicator, Image, Keyboard, Linking, PermissionsAndroid, Platform, Pressable, ScrollView, TextInput, View } from "react-native";
import { launchCamera, launchImageLibrary } from "react-native-image-picker";
import AudioRecorderPlayer from "react-native-audio-recorder-player";
import { pick as pickDocument, isCancel } from "react-native-document-picker";
import { ArrowLeft, Camera, FileText, Hash, ImagePlus, Mic, Paperclip, Play, Plus, Send, Smile, Sparkles, Square, Users, Video, X } from "lucide-react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import type { ChatMessage, ChatThreadDetail } from "../api/types";
import { avatarColor, initials } from "./chatInbox";
import { NuruApi } from "../api/client";
import { uuidv4 } from "../util/uuid";
import { palette, radii, spacing, shadow } from "../theme/tokens";
import { T } from "../theme/components";
import { useChatConversation, useMe, queryKeys } from "../api/hooks";
import { errorMessage, refreshQueries } from "../api/query";
import { writeThrough } from "../sync/offlineWrite";
import { getSyncEngine } from "../sync/engineProvider";
import { getConnectivity } from "../net/connectivity";
import { Loading, ErrorState } from "../components/states";
import { VideoPlayer } from "../components/VideoPlayer";
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

// Tap-to-fill suggested replies above the composer (mobile Chat make).
const QUICK_REPLIES = ["Amen 🙏", "Praying for you 💛", "On my way 🏃", "Thank you 🙏"];
const EMOJIS = ["🙏", "❤️", "🔥", "🎉", "🙌", "😊", "🥹", "💛", "✝️", "🕊️", "👏", "🤝"];

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

export function ChatThreadScreen(): ReactElement {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, "ChatThread">>();
  const { conversationId } = route.params;
  const { data: convo, isLoading, error, refetch } = useChatConversation(conversationId);
  const { data: me } = useMe();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [reactingId, setReactingId] = useState<string | null>(null);
  const [showAttach, setShowAttach] = useState(false); // the "+" attachment grid
  const [showEmoji, setShowEmoji] = useState(false); // the emoji strip
  const [aiBusy, setAiBusy] = useState(false); // sparkle → AI drafting
  const [aiPrev, setAiPrev] = useState<string | null>(null); // draft before an AI suggestion (for Dismiss)
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

  // Transient composer errors (e.g. "media not configured") shouldn't linger —
  // clear them after a few seconds.
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
      const payload = { conversation_id: conversationId, message_id: uuidv4(), body, client_mutation_id: uuidv4() };
      await writeThrough({
        engine: getSyncEngine(),
        connectivity: getConnectivity(),
        online: () => NuruApi.sendChatMessage(conversationId, { message_id: payload.message_id, body, client_mutation_id: payload.client_mutation_id }),
        queued: { domain: "chat_messages", op: "create", payload },
      });
      setText("");
      setAiPrev(null);
      refreshQueries(queryKeys.chatConvo(conversationId));
      refreshQueries(queryKeys.chatInbox);
      void refetch();
    } catch (e) {
      setSendError(composerError(e));
    } finally {
      setSending(false);
    }
  }

  // Photo + video share react-native-image-picker (library or camera); voice
  // notes use react-native-audio-recorder-player and files use
  // react-native-document-picker. All upload direct, never queued (§4.5).
  async function attachMedia(mode: "photo" | "video", fromCamera = false): Promise<void> {
    // Media requires connectivity — bytes upload direct to storage, not queued (§4.5).
    if (!(await getConnectivity().isOnline())) {
      setSendError(`You're offline — ${mode === "video" ? "videos" : "images"} need a connection.`);
      return;
    }
    const result = fromCamera
      ? await launchCamera({ mediaType: mode, quality: 0.8, saveToPhotos: false })
      : await launchImageLibrary({ mediaType: mode, quality: 0.8, selectionLimit: 1 });
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
      setSendError(composerError(e));
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

  async function react(messageId: string, emoji: string): Promise<void> {
    setReactingId(null);
    try {
      await NuruApi.toggleChatReaction(messageId, emoji);
      void refetch();
    } catch {
      /* best-effort; a failed reaction shouldn't interrupt the conversation */
    }
  }

  // Run an attachment action and close the "+" panel.
  function runAttach(fn: () => void): void {
    setShowAttach(false);
    fn();
  }

  // AI in the text box (sparkle): Nuru reads the recent thread and proposes the
  // next message — drafting when the box is empty, polishing when there's a
  // draft. The result fills the input for the member to send, edit, or dismiss
  // (it is NEVER auto-sent). Server-authoritative via the Nuru assistant.
  async function aiAssist(): Promise<void> {
    if (aiBusy || !convo) return;
    setShowEmoji(false);
    setShowAttach(false);
    setAiBusy(true);
    setSendError(null);
    try {
      const draft = text.trim();
      // Nuru reads the last 5 messages server-side (conversation_id) — no transcript
      // is smuggled through the prompt, so it's always grounded in the real thread.
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
        setAiPrev(text); // remember the prior draft so the user can Dismiss
        setText(clean);
      }
    } catch (e) {
      setSendError(composerError(e));
    } finally {
      setAiBusy(false);
    }
  }

  // Restore the draft from before the AI suggestion.
  function dismissAi(): void {
    setText(aiPrev ?? "");
    setAiPrev(null);
  }

  const myInitials = initials(me?.profile?.full_name) || "ME";

  return (
    <View style={st.screen}>
      <View style={st.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => nav.goBack()} style={({ pressed }) => [st.iconBtn, pressed && { transform: [{ scale: 0.95 }] }]}>
          <ArrowLeft size={20} color={palette.onNavy} />
        </Pressable>
        <View style={[st.headAvatar, { backgroundColor: avatarColor(conversationId) }]}>
          {convo?.kind === "space" ? (
            <Hash size={18} color="#fff" />
          ) : convo?.kind === "group" ? (
            <Users size={18} color="#fff" />
          ) : (
            <T variant="heading" style={{ color: "#fff", fontSize: 14 }}>{initials(convo?.title ?? route.params.title)}</T>
          )}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <T variant="heading" tone="onNavy" numberOfLines={1}>
            {convo?.title ?? route.params.title ?? "Conversation"}
          </T>
          {convo ? <T variant="micro" style={{ color: "rgba(255,255,255,0.6)", marginTop: 1 }}>{threadSubtitle(convo)}</T> : null}
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Ask Nuru" onPress={() => nav.navigate("Nuru")} style={({ pressed }) => [st.iconBtn, pressed && { transform: [{ scale: 0.95 }] }]}>
          <Sparkles size={18} color={palette.gold} />
        </Pressable>
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

          {!recording && text.trim().length === 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              style={{ maxHeight: 52 }}
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
                  <T variant="caption" style={{ color: palette.ink }}>{q}</T>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}

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
                {/* "+" attachment grid (Photo · Video · Camera · File · Document · Audio) */}
                {showAttach ? (
                  <View style={st.attachPanel}>
                    <View style={st.attachGrid}>
                      <AttachTile color="#16A34A" Icon={ImagePlus} label="Photo" onPress={() => runAttach(() => void attachMedia("photo"))} />
                      <AttachTile color="#DC2626" Icon={Video} label="Video" onPress={() => runAttach(() => void attachMedia("video"))} />
                      <AttachTile color="#0B1F33" Icon={Camera} label="Camera" onPress={() => runAttach(() => void attachMedia("photo", true))} />
                      <AttachTile color="#0B84E8" Icon={Paperclip} label="File" onPress={() => runAttach(() => void attachFile())} />
                      <AttachTile color="#7C3AED" Icon={FileText} label="Document" onPress={() => runAttach(() => void attachFile())} />
                      <AttachTile color="#DB2777" Icon={Mic} label="Audio" onPress={() => runAttach(() => void startRecording())} />
                    </View>
                  </View>
                ) : null}

                {/* Emoji strip (smiley toggle) */}
                {showEmoji && !showAttach ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={{ maxHeight: 48 }} contentContainerStyle={st.emojiStrip}>
                    {EMOJIS.map((e) => (
                      <Pressable key={e} accessibilityRole="button" accessibilityLabel={`Insert ${e}`} onPress={() => setText((t) => t + e)} style={({ pressed }) => [st.emojiKey, pressed && { transform: [{ scale: 0.9 }] }]}>
                        <T style={{ fontSize: 24 }}>{e}</T>
                      </Pressable>
                    ))}
                  </ScrollView>
                ) : null}

                {/* Nuru suggestion banner — edit it, send it, or dismiss to restore your draft */}
                {aiPrev !== null ? (
                  <View style={st.aiHint}>
                    <Sparkles size={14} color={palette.goldLo} />
                    <T variant="caption" tone="secondary" style={{ flex: 1 }}>Nuru suggested this — edit, send, or</T>
                    <Pressable accessibilityRole="button" accessibilityLabel="Dismiss suggestion" onPress={dismissAi} hitSlop={8}>
                      <T variant="caption" style={{ color: palette.goldLo, fontWeight: "800" }}>Dismiss</T>
                    </Pressable>
                  </View>
                ) : null}

                {sendError ? <T variant="caption" style={{ color: palette.error, marginBottom: 6, marginLeft: 56 }}>{sendError}</T> : null}

                <View style={st.composerRow}>
                  {/* My avatar */}
                  <View style={[st.composerAvatar, { backgroundColor: palette.navy }]}>
                    <T variant="heading" style={{ color: "#fff", fontSize: 13 }}>{myInitials}</T>
                  </View>

                  {/* Rounded input pill: + · text · AI · emoji */}
                  <View style={st.inputPill}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={showAttach ? "Close attachments" : "Add attachment"}
                      onPress={() => { setShowEmoji(false); setShowAttach((v) => !v); }}
                      style={({ pressed }) => [showAttach ? st.plusOpen : st.plusBtn, pressed && { opacity: 0.7 }]}
                    >
                      {showAttach ? <X size={18} color={palette.goldLo} /> : <Plus size={24} color={palette.ink400} />}
                    </Pressable>
                    <TextInput
                      value={text}
                      onChangeText={(t) => { setText(t); if (aiPrev !== null) setAiPrev(null); }}
                      onFocus={() => { setShowAttach(false); setShowEmoji(false); }}
                      placeholder="Message"
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
                      {aiBusy ? <ActivityIndicator size="small" color={palette.goldLo} /> : <Sparkles size={18} color={palette.goldLo} />}
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

                  {/* Send when there's text, else record a voice note */}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={text.trim().length > 0 ? "Send" : "Record voice note"}
                    onPress={() => (text.trim().length > 0 ? void send() : void startRecording())}
                    disabled={sending}
                    style={({ pressed }) => [st.sendBtn, pressed && { transform: [{ scale: 0.94 }] }]}
                  >
                    {text.trim().length > 0 ? <Send size={20} color="#fff" /> : <Mic size={20} color="#fff" />}
                  </Pressable>
                </View>
              </>
            )}
          </View>
        </>
      )}
    </View>
  );
}

/** One tile in the "+" attachment grid (Photo/Video/Camera/File/Document/Audio). */
function AttachTile({ color, Icon, label, onPress }: { color: string; Icon: typeof Mic; label: string; onPress: () => void }): ReactElement {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [st.attachTile, pressed && { transform: [{ scale: 0.96 }] }]}>
      <View style={[st.attachTileIcon, { backgroundColor: color }]}><Icon size={22} color="#fff" /></View>
      <T variant="caption" style={{ color: palette.ink, fontWeight: "600" }}>{label}</T>
    </Pressable>
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
  const [videoOpen, setVideoOpen] = useState(false);
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
          videoOpen ? (
            <View style={{ width: 248, maxWidth: "100%" }}>
              <VideoPlayer uri={m.attachment_url} height={150} radius={12} />
            </View>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Play video"
              onPress={() => setVideoOpen(true)}
              style={st.mediaChip}
            >
              <Play size={14} color={chipColor} /><T variant="caption" style={{ color: m.mine ? "#fff" : palette.ink }}>Play video</T>
            </Pressable>
          )
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
  headAvatar: { width: 40, height: 40, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  quickRow: { gap: spacing.sm, paddingHorizontal: spacing.screen, paddingVertical: spacing.sm },
  quickChip: { backgroundColor: palette.white, borderRadius: radii.pill, borderWidth: 1, borderColor: palette.border, paddingHorizontal: spacing.base, height: 38, alignItems: "center", justifyContent: "center", ...shadow.card },
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
    paddingHorizontal: spacing.base, paddingTop: spacing.md, paddingBottom: spacing.lg,
  },
  // Composer row: avatar · input pill · send/mic
  composerRow: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm },
  composerAvatar: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  inputPill: {
    flex: 1, flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: palette.coolPaper, borderRadius: 26, borderWidth: 1, borderColor: palette.border,
    paddingLeft: 6, paddingRight: 8, minHeight: 48,
  },
  plusBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  plusOpen: { width: 36, height: 36, borderRadius: 11, borderWidth: 1.5, borderColor: "rgba(201,162,39,0.6)", backgroundColor: palette.goldTint, alignItems: "center", justifyContent: "center" },
  inputFlex: { flex: 1, paddingVertical: Platform.OS === "ios" ? 12 : 6, paddingHorizontal: 2, maxHeight: 120, fontSize: 16, color: palette.ink, textAlignVertical: "center" },
  aiBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: palette.goldTint, alignItems: "center", justifyContent: "center" },
  emojiBtn: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  sendBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: palette.navy, alignItems: "center", justifyContent: "center" },
  // "+" attachment grid
  attachPanel: { backgroundColor: palette.white, borderRadius: 20, borderWidth: 1, borderColor: palette.border, padding: spacing.base, marginBottom: spacing.md, ...shadow.card },
  attachGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: spacing.base },
  attachTile: { width: "31%", alignItems: "center", gap: 8, paddingVertical: spacing.sm, borderRadius: 16, backgroundColor: palette.surface },
  attachTileIcon: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center" },
  emojiStrip: { gap: spacing.sm, paddingHorizontal: 56, paddingVertical: spacing.sm, alignItems: "center" },
  aiHint: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: palette.goldTint, borderRadius: 12, paddingHorizontal: spacing.md, paddingVertical: 8, marginBottom: spacing.sm },
  emojiKey: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  input: {
    backgroundColor: palette.coolPaper, borderRadius: radii.control, borderWidth: 1, borderColor: palette.border,
    paddingHorizontal: spacing.base, paddingTop: spacing.md, minHeight: 48, maxHeight: 120, fontSize: 15, color: palette.ink, textAlignVertical: "top",
  },
} as const;
