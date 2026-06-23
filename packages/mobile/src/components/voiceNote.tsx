// Reusable voice-note recorder + player (Prayer Wall compose/comment). Records
// with the native recorder while sampling the mic meter into a waveform, uploads
// the bytes via the member-accessible chat attachment sign → Cloudinary flow (no
// new backend), and returns the URL + waveform. The waveform is persisted so the
// amplitude bars render for everyone viewing the post — not just the recorder.
// The player taps to play/stop and fills the bars as playback advances. Voice
// notes need connectivity (bytes upload direct).
import { useRef, useState, type ReactElement } from "react";
import { PermissionsAndroid, Platform, Pressable, View } from "react-native";
import { Mic, Play, Square, X } from "lucide-react-native";
import AudioRecorderPlayer from "react-native-audio-recorder-player";
import { NuruApi } from "../api/client";
import { getConnectivity } from "../net/connectivity";
import { voiceFileName } from "../screens/chatMediaHelpers";
import { palette, radii, spacing } from "../theme/tokens";
import { T } from "../theme/components";

const recorder = AudioRecorderPlayer;

// How many bars we keep for the live scroll and persist for playback. Kept small
// so the stored array is tiny (jsonb) and the bars stay legible on a phone.
const BARS = 40;
// Mic meter is in dBFS (negative; 0 = max). Treat anything quieter than the floor
// as silence so spoken voice fills most of the range.
const DB_FLOOR = -50;

function micPermission(): Promise<boolean> {
  if (Platform.OS !== "android") return Promise.resolve(true); // iOS prompts on first record
  const perm = PermissionsAndroid.PERMISSIONS.RECORD_AUDIO ?? "android.permission.RECORD_AUDIO";
  return PermissionsAndroid.request(perm, { title: "Microphone access", message: "Record a voice note for your prayer.", buttonPositive: "Allow" }).then(
    (g) => g === PermissionsAndroid.RESULTS.GRANTED,
  );
}

function clock(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// dBFS sample → 0..100 bar height, with a small floor so even quiet moments draw.
function meterToBar(db: number | undefined, position: number): number {
  if (db == null || !Number.isFinite(db)) {
    // Metering unsupported on this platform — draw a gentle breathing wave so the
    // recorder still feels alive.
    return Math.round(35 + 30 * Math.abs(Math.sin(position / 280)));
  }
  const norm = Math.max(0, Math.min(1, (db - DB_FLOOR) / -DB_FLOOR));
  return Math.round(8 + Math.pow(norm, 0.7) * 92);
}

// Collapse all captured samples into BARS peaks (loudest wins per chunk).
function downsample(samples: number[]): number[] {
  if (samples.length === 0) return [];
  if (samples.length <= BARS) return samples.map((v) => Math.round(v));
  const out: number[] = [];
  const per = samples.length / BARS;
  for (let i = 0; i < BARS; i++) {
    let peak = 0;
    for (let j = Math.floor(i * per); j < Math.floor((i + 1) * per); j++) peak = Math.max(peak, samples[j] ?? 0);
    out.push(Math.round(peak));
  }
  return out;
}

export interface VoiceNote {
  recording: boolean;
  recordMs: number;
  uploading: boolean;
  audioUrl: string | null;
  waveform: number[]; // final, persisted bars (0..100)
  liveSamples: number[]; // rolling tail for the recording animation (0..100)
  start: () => Promise<string | null>; // returns an error message or null
  cancel: () => Promise<void>;
  stopAndUpload: () => Promise<string | null>; // returns the uploaded url or null
  reset: () => void;
}

export function useVoiceNote(): VoiceNote {
  const [recording, setRecording] = useState(false);
  const [recordMs, setRecordMs] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [waveform, setWaveform] = useState<number[]>([]);
  const [liveSamples, setLiveSamples] = useState<number[]>([]);
  const pathRef = useRef<string | null>(null);
  const allRef = useRef<number[]>([]);

  async function start(): Promise<string | null> {
    if (!(await getConnectivity().isOnline())) return "You're offline — voice notes need a connection.";
    if (!(await micPermission())) return "Microphone permission is needed to record.";
    setRecordMs(0);
    setLiveSamples([]);
    allRef.current = [];
    try {
      recorder.setSubscriptionDuration(0.06); // ~16 meter readings/sec for a smooth wave
      const path = await recorder.startRecorder(undefined, undefined, true); // meteringEnabled
      pathRef.current = path;
      recorder.addRecordBackListener((e) => {
        setRecordMs(e.currentPosition);
        const bar = meterToBar(e.currentMetering, e.currentPosition);
        allRef.current.push(bar);
        setLiveSamples((prev) => {
          const next = prev.length >= BARS ? prev.slice(prev.length - BARS + 1) : prev.slice();
          next.push(bar);
          return next;
        });
      });
      setRecording(true);
      return null;
    } catch {
      return "Couldn't start recording.";
    }
  }

  async function cancel(): Promise<void> {
    recorder.removeRecordBackListener();
    setRecording(false);
    setRecordMs(0);
    setLiveSamples([]);
    allRef.current = [];
    try { await recorder.stopRecorder(); } catch { /* ignore */ }
    pathRef.current = null;
  }

  async function stopAndUpload(): Promise<string | null> {
    recorder.removeRecordBackListener();
    let uri: string | undefined;
    try { uri = await recorder.stopRecorder(); } catch { /* ignore */ }
    setRecording(false);
    const path = pathRef.current ?? uri;
    pathRef.current = null;
    setRecordMs(0);
    const bars = downsample(allRef.current);
    allRef.current = [];
    setLiveSamples([]);
    if (!path) return null;
    setUploading(true);
    try {
      const contentType = "audio/m4a";
      const sign = await NuruApi.signChatAttachment({ content_type: contentType, kind: "voice" });
      const up = await NuruApi.uploadChatAttachment(sign, { uri: path, name: voiceFileName(), type: contentType });
      setAudioUrl(up.secure_url);
      setWaveform(bars);
      return up.secure_url;
    } catch {
      return null;
    } finally {
      setUploading(false);
    }
  }

  function reset(): void {
    setAudioUrl(null);
    setWaveform([]);
    setLiveSamples([]);
    setRecordMs(0);
  }

  return { recording, recordMs, uploading, audioUrl, waveform, liveSamples, start, cancel, stopAndUpload, reset };
}

/** Amplitude bars. `progress` (0..1) fills bars left→right for playback. */
export function Waveform({
  data,
  progress = 0,
  height = 28,
  barColor = palette.ink300,
  fillColor = palette.navyDeep,
  barWidth = 3,
  gap = 2,
}: {
  data: number[];
  progress?: number;
  height?: number;
  barColor?: string;
  fillColor?: string;
  barWidth?: number;
  gap?: number;
}): ReactElement {
  const bars = data.length > 0 ? data : Array.from({ length: BARS }, () => 14); // resting line
  return (
    <View style={{ flexDirection: "row", alignItems: "center", height, gap }}>
      {bars.map((v, i) => {
        const h = Math.max(3, (Math.max(0, Math.min(100, v)) / 100) * height);
        const filled = progress > 0 && (i + 0.5) / bars.length <= progress;
        return <View key={i} style={{ width: barWidth, height: h, borderRadius: barWidth, backgroundColor: filled ? fillColor : barColor }} />;
      })}
    </View>
  );
}

/** Compact recorder control for a composer row: mic → live waveform (timer +
 *  stop/✕) → attached chip with its captured waveform. Drives a useVoiceNote(). */
export function VoiceRecorderButton({ v, onError }: { v: VoiceNote; onError?: (m: string) => void }): ReactElement {
  if (v.audioUrl) {
    return (
      <View style={chip.attached}>
        <Mic size={14} color={palette.success} />
        <Waveform data={v.waveform} height={22} barWidth={2.5} gap={1.5} barColor={palette.success} fillColor={palette.success} />
        <Pressable accessibilityRole="button" accessibilityLabel="Remove voice note" onPress={v.reset} hitSlop={8}>
          <X size={14} color={palette.ink400} />
        </Pressable>
      </View>
    );
  }
  if (v.recording) {
    return (
      <View style={chip.recording}>
        <View style={chip.dot} />
        <View style={{ flex: 1 }}>
          <Waveform data={v.liveSamples} height={24} barWidth={2.5} gap={1.5} barColor={palette.error} fillColor={palette.error} />
        </View>
        <T variant="caption" style={{ color: palette.ink, fontWeight: "700" }}>{clock(v.recordMs)}</T>
        <Pressable accessibilityRole="button" accessibilityLabel="Cancel recording" onPress={() => void v.cancel()} hitSlop={8}>
          <X size={16} color={palette.ink600} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Stop recording" onPress={() => void v.stopAndUpload()} style={chip.stop}>
          <Square size={13} color="#fff" fill="#fff" />
        </Pressable>
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Record a voice note"
      disabled={v.uploading}
      onPress={() => void v.start().then((err) => err && onError?.(err))}
      style={[chip.mic, v.uploading && { opacity: 0.5 }]}
    >
      <Mic size={18} color={palette.goldLo} />
    </Pressable>
  );
}

/** Tap-to-play voice-note pill with its waveform; bars fill as it plays. */
export function VoiceNotePlayer({ url, waveform }: { url: string; waveform?: number[] | null }): ReactElement {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  async function toggle(): Promise<void> {
    if (playing) {
      recorder.removePlayBackListener();
      recorder.removePlaybackEndListener();
      await recorder.stopPlayer().catch(() => undefined);
      setPlaying(false);
      setProgress(0);
      return;
    }
    try {
      recorder.addPlayBackListener((e) => { if (e.duration > 0) setProgress(e.currentPosition / e.duration); });
      recorder.addPlaybackEndListener(() => {
        recorder.removePlayBackListener();
        recorder.removePlaybackEndListener();
        setPlaying(false);
        setProgress(0);
      });
      await recorder.startPlayer(url);
      setPlaying(true);
    } catch {
      setPlaying(false);
    }
  }
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={playing ? "Stop voice note" : "Play voice note"} onPress={() => void toggle()} style={chip.player}>
      {playing ? <Square size={14} color={palette.navyDeep} fill={palette.navyDeep} /> : <Play size={14} color={palette.navyDeep} />}
      <Waveform data={waveform ?? []} progress={progress} height={26} barWidth={2.5} gap={1.5} barColor={palette.gold} fillColor={palette.navyDeep} />
    </Pressable>
  );
}

const chip = {
  mic: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  recording: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.sm, height: 44, borderRadius: radii.control, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: palette.error },
  stop: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: palette.navyDeep },
  attached: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 8, borderRadius: radii.pill, backgroundColor: palette.successBg },
  player: { flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "flex-start", paddingHorizontal: 12, paddingVertical: 7, borderRadius: radii.pill, backgroundColor: palette.goldChipBg, borderWidth: 1, borderColor: palette.urgentBorder, marginTop: spacing.sm },
} as const;
