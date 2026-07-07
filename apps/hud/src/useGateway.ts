/**
 * useGateway — the HUD's live state, derived from the gateway event stream.
 *
 * Folds OsEvents into the view models the widgets render: operations (the audit
 * trail / V.A.U.L.T. feed), streaming output, notifications, the current auth
 * prompt, the latest spoken line, a rolling signal-rate series, and the
 * derived "core state" (idle / listening / thinking / speaking).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ClientCommand, OsEvent, SkillCard } from "@aos/shared";
import { announceIfIdle, onSpeakingChange, primeAudio, speakNow, stopSpeaking } from "./audio-player.js";
import {
  GatewayClient,
  type ConfigView,
  type ConnectionStatus,
  type MisakiStatus,
  type SidecarActionResult,
  type SidecarHealth,
  type TtsStatus,
  type VoiceEnv,
  type VaultDoc,
  type VaultSummary,
} from "./gateway.js";

export type CoreState = "idle" | "listening" | "thinking" | "speaking";

export interface OperationView {
  opId: string;
  actionId: string;
  skillId: string | null;
  status: "running" | "done" | "failed";
  exitCode?: number | null;
  error?: string;
  startedAt: string;
  output: string;
}

export interface NotificationView {
  id: number;
  level: "info" | "warn" | "error";
  message: string;
  at: string;
}

export interface AuthPromptView {
  service: string;
  verificationUri: string;
  userCode: string;
  message: string;
}

/**
 * A finished operation, surfaced as a notification card orbiting the core.
 * Spawned on completion; clicking a card with a `resultPath` opens that doc.
 * `unheard` marks a result whose spoken announcement was skipped (the voice was
 * busy) — the user can click to hear it, which clears the flag.
 */
export interface TaskCardView {
  id: number;
  opId: string;
  label: string;
  status: "done" | "failed";
  resultPath?: string;
  resultType?: string;
  error?: string;
  at: string;
  unheard?: boolean;
}

export interface HudState {
  status: ConnectionStatus;
  skills: SkillCard[];
  operations: OperationView[];
  notifications: NotificationView[];
  auth: AuthPromptView | null;
  lastSpeech: { text: string; at: number } | null;
  signals: number;
  signalSeries: number[];
  coreState: CoreState;
  running: number;
  queued: number;
  records: VaultSummary[];
  openDocPath: string | null;
  taskCards: TaskCardView[];
  send: (cmd: ClientCommand) => void;
  clearNotifications: () => void;
  dismissCard: (id: number) => void;
  clearCards: () => void;
  speakCard: (id: number, path: string) => void;
  setListening: (on: boolean) => void;
  openDoc: (path: string) => void;
  closeDoc: () => void;
  fetchDoc: (path: string) => Promise<VaultDoc | null>;
  fetchConfig: () => Promise<ConfigView>;
  saveSettings: (partial: Record<string, string>) => Promise<void>;
  saveSecret: (key: string, value: string) => Promise<void>;
  getTtsStatus: (provider: string) => Promise<TtsStatus>;
  installTts: () => Promise<TtsStatus>;
  getMisakiStatus: () => Promise<MisakiStatus>;
  installMisaki: () => Promise<MisakiStatus>;
  getSidecarHealth: () => Promise<SidecarHealth>;
  getVoiceEnv: () => Promise<VoiceEnv>;
  startSidecar: () => Promise<SidecarActionResult>;
  stopSidecar: () => Promise<SidecarActionResult>;
  transcribe: (blob: Blob) => Promise<{ text: string }>;
}

const MAX_OPS = 60;
const MAX_NOTES = 40;
const MAX_CARDS = 24;
const SERIES_LEN = 32;

/** "inbox-triage" -> "Inbox triage" — a readable fallback label. */
function prettify(id: string): string {
  const s = id.replace(/[-_]+/g, " ").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : id;
}

// Task notification cards persist until dismissed — survive reload / restart.
const CARDS_KEY = "aos.taskCards";

function loadCards(): TaskCardView[] {
  try {
    const raw = localStorage.getItem(CARDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as TaskCardView[]).slice(0, MAX_CARDS) : [];
  } catch {
    return [];
  }
}

function saveCards(cards: TaskCardView[]): void {
  try {
    localStorage.setItem(CARDS_KEY, JSON.stringify(cards));
  } catch {
    /* storage unavailable / quota — non-fatal */
  }
}

export function useGateway(): HudState {
  const clientRef = useRef<GatewayClient>();
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [skills, setSkills] = useState<SkillCard[]>([]);
  const [operations, setOperations] = useState<OperationView[]>([]);
  const [notifications, setNotifications] = useState<NotificationView[]>([]);
  const [auth, setAuth] = useState<AuthPromptView | null>(null);
  const [lastSpeech, setLastSpeech] = useState<{ text: string; at: number } | null>(null);
  const [signals, setSignals] = useState(0);
  const [signalSeries, setSignalSeries] = useState<number[]>(() => Array(SERIES_LEN).fill(0));
  const [listening, setListeningRaw] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [records, setRecords] = useState<VaultSummary[]>([]);
  const [openDocPath, setOpenDocPath] = useState<string | null>(null);
  const [taskCards, setTaskCards] = useState<TaskCardView[]>(loadCards);
  const [running, setRunning] = useState(0);
  const [queued, setQueued] = useState(0);

  const noteId = useRef(0);
  // Seed past any persisted ids so new cards never collide with restored ones.
  const cardId = useRef(taskCards.reduce((m, c) => Math.max(m, c.id + 1), 0));
  // opId -> the started op's identity, so completion cards can be labelled.
  const opMeta = useRef(new Map<string, { actionId: string; skillId: string | null }>());
  const sinceTick = useRef(0);
  const runningCount = useRef(0);
  const [runningTick, setRunningTick] = useState(0); // forces coreState recompute
  const [settledCount, setSettledCount] = useState(0); // refetch vault on op end

  const handleEvent = useCallback((e: OsEvent) => {
    setSignals((n) => n + 1);
    sinceTick.current += 1;

    switch (e.type) {
      case "operation.queued":
        setQueued((q) => q + 1);
        break;
      case "operation.started":
        runningCount.current += 1;
        setRunningTick((t) => t + 1);
        setRunning((r) => r + 1);
        setQueued((q) => Math.max(0, q - 1));
        opMeta.current.set(e.op.opId, { actionId: e.op.actionId, skillId: e.op.skillId });
        setOperations((ops) =>
          [
            {
              opId: e.op.opId,
              actionId: e.op.actionId,
              skillId: e.op.skillId,
              status: "running" as const,
              startedAt: e.at,
              output: "",
            },
            ...ops,
          ].slice(0, MAX_OPS),
        );
        break;
      case "operation.output":
        setOperations((ops) =>
          ops.map((o) => (o.opId === e.opId ? { ...o, output: (o.output + e.chunk).slice(-4000) } : o)),
        );
        break;
      case "operation.completed": {
        runningCount.current = Math.max(0, runningCount.current - 1);
        setRunningTick((t) => t + 1);
        setRunning((r) => Math.max(0, r - 1));
        setSettledCount((c) => c + 1);
        setOperations((ops) =>
          ops.map((o) => (o.opId === e.opId ? { ...o, status: "done", exitCode: e.exitCode } : o)),
        );
        // A completed op that produced a vault record spawns a notification card.
        if (e.result) {
          const result = e.result;
          setTaskCards((cards) =>
            [
              {
                id: cardId.current++,
                opId: e.opId,
                label: result.title,
                status: "done" as const,
                resultPath: result.path,
                resultType: result.type,
                at: e.at,
              },
              ...cards.filter((c) => c.opId !== e.opId),
            ].slice(0, MAX_CARDS),
          );
        }
        opMeta.current.delete(e.opId);
        break;
      }
      case "operation.failed": {
        runningCount.current = Math.max(0, runningCount.current - 1);
        setRunningTick((t) => t + 1);
        setRunning((r) => Math.max(0, r - 1));
        setSettledCount((c) => c + 1);
        setOperations((ops) =>
          ops.map((o) => (o.opId === e.opId ? { ...o, status: "failed", error: e.error } : o)),
        );
        const meta = opMeta.current.get(e.opId);
        const label = prettify(meta?.skillId ?? meta?.actionId ?? "task");
        setTaskCards((cards) =>
          [
            { id: cardId.current++, opId: e.opId, label, status: "failed" as const, error: e.error, at: e.at },
            ...cards.filter((c) => c.opId !== e.opId),
          ].slice(0, MAX_CARDS),
        );
        opMeta.current.delete(e.opId);
        break;
      }
      case "notification":
        setNotifications((n) =>
          [{ id: noteId.current++, level: e.level, message: e.message, at: e.at }, ...n].slice(0, MAX_NOTES),
        );
        break;
      case "speech":
        setLastSpeech({ text: e.text, at: Date.now() });
        if (e.audioUrl) {
          if (e.onDemand) {
            // The Speak button: interrupt and play now.
            speakNow(e.audioUrl);
          } else if (!announceIfIdle(e.audioUrl) && e.path) {
            // Voice was busy — don't queue; flag the matching card as unheard
            // so the user can pull it when they want.
            const path = e.path;
            setTaskCards((cards) => cards.map((c) => (c.resultPath === path ? { ...c, unheard: true } : c)));
          }
        }
        break;
      case "auth.prompt":
        setAuth({ service: e.service, verificationUri: e.verificationUri, userCode: e.userCode, message: e.message });
        break;
      case "auth.resolved":
        setAuth(null);
        break;
    }
  }, []);

  useEffect(() => {
    const client = new GatewayClient(handleEvent, setStatus);
    clientRef.current = client;
    client.connect();
    return () => client.dispose();
  }, [handleEvent]);

  // Persist notification cards so undismissed ones survive reload / restart.
  useEffect(() => {
    saveCards(taskCards);
  }, [taskCards]);

  // Load the command deck once online (retry while offline).
  useEffect(() => {
    if (status !== "online") return;
    let alive = true;
    clientRef.current
      ?.fetchSkills()
      .then((s) => alive && setSkills(s))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [status]);

  // Refresh the vault feed when online and whenever an operation settles.
  useEffect(() => {
    if (status !== "online") return;
    let alive = true;
    clientRef.current
      ?.fetchRecent()
      .then((r) => alive && setRecords(r))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [status, settledCount]);

  // Sample the signal rate every 2s for the sparkline / big counter.
  useEffect(() => {
    const id = window.setInterval(() => {
      setSignalSeries((s) => [...s.slice(1), sinceTick.current]);
      sinceTick.current = 0;
    }, 2000);
    return () => window.clearInterval(id);
  }, []);

  const send = useCallback((cmd: ClientCommand) => clientRef.current?.send(cmd), []);
  const clearNotifications = useCallback(() => setNotifications([]), []);
  const dismissCard = useCallback((id: number) => setTaskCards((cards) => cards.filter((c) => c.id !== id)), []);
  const clearCards = useCallback(() => setTaskCards([]), []);
  const openDoc = useCallback((path: string) => {
    setOpenDocPath(path);
    // Reading a result counts as hearing it — clear any unheard flag.
    setTaskCards((cards) => cards.map((c) => (c.resultPath === path && c.unheard ? { ...c, unheard: false } : c)));
  }, []);
  const closeDoc = useCallback(() => setOpenDocPath(null), []);
  const fetchDoc = useCallback(
    (path: string) => clientRef.current?.fetchDoc(path) ?? Promise.resolve(null),
    [],
  );
  const fetchConfig = useCallback(
    () => clientRef.current?.fetchConfig() ?? Promise.reject(new Error("not connected")),
    [],
  );
  const saveSettings = useCallback(
    (partial: Record<string, string>) => clientRef.current?.saveSettings(partial) ?? Promise.resolve(),
    [],
  );
  const saveSecret = useCallback(
    (key: string, value: string) => clientRef.current?.saveSecret(key, value) ?? Promise.resolve(),
    [],
  );
  const getTtsStatus = useCallback(
    (provider: string) => clientRef.current?.getTtsStatus(provider) ?? Promise.reject(new Error("not connected")),
    [],
  );
  const installTts = useCallback(
    () => clientRef.current?.installTts() ?? Promise.reject(new Error("not connected")),
    [],
  );
  const getMisakiStatus = useCallback(
    () => clientRef.current?.getMisakiStatus() ?? Promise.reject(new Error("not connected")),
    [],
  );
  const installMisaki = useCallback(
    () => clientRef.current?.installMisaki() ?? Promise.reject(new Error("not connected")),
    [],
  );
  const getSidecarHealth = useCallback(
    () => clientRef.current?.getSidecarHealth() ?? Promise.reject(new Error("not connected")),
    [],
  );
  const getVoiceEnv = useCallback(
    () => clientRef.current?.getVoiceEnv() ?? Promise.reject(new Error("not connected")),
    [],
  );
  const startSidecar = useCallback(
    () => clientRef.current?.startSidecar() ?? Promise.reject(new Error("not connected")),
    [],
  );
  const stopSidecar = useCallback(
    () => clientRef.current?.stopSidecar() ?? Promise.reject(new Error("not connected")),
    [],
  );
  const transcribe = useCallback(
    (blob: Blob) => clientRef.current?.transcribe(blob) ?? Promise.reject(new Error("not connected")),
    [],
  );

  // Mirror the single voice channel's real playback state into React.
  useEffect(() => onSpeakingChange(setSpeaking), []);

  // Unlock audio on the user's first interaction so later (async) TTS clips
  // aren't silently blocked by the browser autoplay policy.
  useEffect(() => {
    const prime = () => primeAudio();
    window.addEventListener("pointerdown", prime, { once: true });
    window.addEventListener("keydown", prime, { once: true });
    return () => {
      window.removeEventListener("pointerdown", prime);
      window.removeEventListener("keydown", prime);
    };
  }, []);

  // Barge-in: the moment you start talking (hold-to-talk) or typing (command
  // bar focus), cut the OS off mid-sentence — one voice at a time, and it's
  // rude to talk over the user.
  const setListening = useCallback((on: boolean) => {
    if (on) stopSpeaking();
    setListeningRaw(on);
  }, []);

  // Speak a result card on demand (interrupts current audio) and clear its
  // unheard flag — the user chose to hear it.
  const speakCard = useCallback((id: number, path: string) => {
    clientRef.current?.send({ type: "speak", path });
    setTaskCards((cards) => cards.map((c) => (c.id === id ? { ...c, unheard: false } : c)));
  }, []);

  const coreState: CoreState = useMemo(() => {
    if (runningCount.current > 0) return "thinking";
    if (speaking) return "speaking";
    if (listening) return "listening";
    return "idle";
    // runningTick participates so this recomputes when running count changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runningTick, speaking, listening]);

  return {
    status,
    skills,
    operations,
    notifications,
    auth,
    lastSpeech,
    signals,
    signalSeries,
    coreState,
    running,
    queued,
    records,
    openDocPath,
    taskCards,
    send,
    clearNotifications,
    dismissCard,
    clearCards,
    speakCard,
    setListening,
    openDoc,
    closeDoc,
    fetchDoc,
    fetchConfig,
    saveSettings,
    saveSecret,
    getTtsStatus,
    installTts,
    getMisakiStatus,
    installMisaki,
    getSidecarHealth,
    getVoiceEnv,
    startSidecar,
    stopSidecar,
    transcribe,
  };
}
