/**
 * The ONE spawn-collect-timeout helper for the gateway. Every child process the
 * gateway starts goes through here so timeout/kill semantics are uniform.
 * Never rejects — callers map the result to their own error style.
 */
import { spawn } from "node:child_process";

export interface RunProcessOptions {
  stdin?: string;
  /** Kill (whole tree) and resolve with `timedOut: true` after this. */
  timeoutMs?: number;
  /** shell:true is needed on Windows to resolve .cmd shims (e.g. claude.cmd). */
  shell?: boolean;
  /** Streaming tap — receives each chunk as it arrives. */
  onOutput?: (stream: "stdout" | "stderr", chunk: string) => void;
  /**
   * Accumulate stdio into the result strings (default true). Callers that only
   * consume the streaming tap should pass false so a verbose long-running child
   * doesn't buffer megabytes the caller never reads.
   */
  capture?: boolean;
}

export interface RunProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  /** Set when the process could not be spawned at all. */
  spawnError?: string;
}

export const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Kill a child and everything it spawned. On Windows, `child.kill()` only
 * terminates the direct child — for shell:true / `cmd /c` wrappers that's just
 * cmd.exe, orphaning the real claude/yt-dlp grandchild — so use `taskkill /T`.
 */
function killTree(child: ReturnType<typeof spawn>): void {
  if (process.platform === "win32" && child.pid) {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" }).on("error", () => {
      child.kill("SIGKILL"); // taskkill unavailable — best effort
    });
  } else {
    child.kill("SIGKILL");
  }
}

export function runProcess(
  command: string,
  args: string[],
  opts: RunProcessOptions = {},
): Promise<RunProcessResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const capture = opts.capture ?? true;
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;

    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      shell: opts.shell ?? false,
    });

    const finish = (r: RunProcessResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };

    const timer = setTimeout(() => {
      killTree(child);
      finish({ code: null, stdout, stderr, timedOut: true });
    }, timeoutMs);

    child.stdout.on("data", (d: Buffer) => {
      const s = d.toString();
      if (capture) stdout += s;
      opts.onOutput?.("stdout", s);
    });
    child.stderr.on("data", (d: Buffer) => {
      const s = d.toString();
      if (capture) stderr += s;
      opts.onOutput?.("stderr", s);
    });
    child.on("error", (err) => finish({ code: null, stdout, stderr, timedOut: false, spawnError: err.message }));
    child.on("close", (code) => finish({ code, stdout, stderr, timedOut: false }));

    // A failed spawn can EPIPE the stdin stream — swallow it (the error event handles reporting).
    child.stdin.on("error", () => {});
    if (opts.stdin !== undefined) child.stdin.write(opts.stdin);
    child.stdin.end();
  });
}
