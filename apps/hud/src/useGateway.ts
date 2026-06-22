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
import {
  GatewayClient,
  type ConfigView,
  type ConnectionStatus,
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
  records: VaultSummary[];
  openDocPath: string | null;
  send: (cmd: ClientCommand) => void;
  clearNotifications: () => void;
  setListening: (on: boolean) => void;
  openDoc: (path: string) => void;
  closeDoc: () => void;
  fetchDoc: (path: string) => Promise<VaultDoc | null>;
  fetchConfig: () => Promise<ConfigView>;
}

const MAX_OPS = 60;
const MAX_NOTES = 40;
const SERIES_LEN = 32;

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
  const [listening, setListening] = useState(false);
  const [records, setRecords] = useState<VaultSummary[]>([]);
  const [openDocPath, setOpenDocPath] = useState<string | null>(null);

  const noteId = useRef(0);
  const sinceTick = useRef(0);
  const runningCount = useRef(0);
  const [runningTick, setRunningTick] = useState(0); // forces coreState recompute
  const [settledCount, setSettledCount] = useState(0); // refetch vault on op end

  const handleEvent = useCallback((e: OsEvent) => {
    setSignals((n) => n + 1);
    sinceTick.current += 1;

    switch (e.type) {
      case "operation.started":
        runningCount.current += 1;
        setRunningTick((t) => t + 1);
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
      case "operation.completed":
        runningCount.current = Math.max(0, runningCount.current - 1);
        setRunningTick((t) => t + 1);
        setSettledCount((c) => c + 1);
        setOperations((ops) =>
          ops.map((o) => (o.opId === e.opId ? { ...o, status: "done", exitCode: e.exitCode } : o)),
        );
        break;
      case "operation.failed":
        runningCount.current = Math.max(0, runningCount.current - 1);
        setRunningTick((t) => t + 1);
        setSettledCount((c) => c + 1);
        setOperations((ops) =>
          ops.map((o) => (o.opId === e.opId ? { ...o, status: "failed", error: e.error } : o)),
        );
        break;
      case "notification":
        setNotifications((n) =>
          [{ id: noteId.current++, level: e.level, message: e.message, at: e.at }, ...n].slice(0, MAX_NOTES),
        );
        break;
      case "speech":
        setLastSpeech({ text: e.text, at: Date.now() });
        if (e.audioUrl) void new Audio(e.audioUrl).play().catch(() => {});
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
  const openDoc = useCallback((path: string) => setOpenDocPath(path), []);
  const closeDoc = useCallback(() => setOpenDocPath(null), []);
  const fetchDoc = useCallback(
    (path: string) => clientRef.current?.fetchDoc(path) ?? Promise.resolve(null),
    [],
  );
  const fetchConfig = useCallback(
    () => clientRef.current?.fetchConfig() ?? Promise.reject(new Error("not connected")),
    [],
  );

  const coreState: CoreState = useMemo(() => {
    if (runningCount.current > 0) return "thinking";
    if (lastSpeech && Date.now() - lastSpeech.at < 3500) return "speaking";
    if (listening) return "listening";
    return "idle";
    // runningTick participates so this recomputes when running count changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runningTick, lastSpeech, listening]);

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
    records,
    openDocPath,
    send,
    clearNotifications,
    setListening,
    openDoc,
    closeDoc,
    fetchDoc,
    fetchConfig,
  };
}
