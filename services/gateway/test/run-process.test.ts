import { describe, expect, it } from "vitest";
import { runProcess } from "../src/util/run-process.js";

const NODE = process.execPath;

describe("runProcess", () => {
  it("captures stdout and a zero exit code", async () => {
    const r = await runProcess(NODE, ["-e", "console.log('hi')"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("hi");
    expect(r.timedOut).toBe(false);
  });

  it("reports a non-zero exit code with stderr", async () => {
    const r = await runProcess(NODE, ["-e", "console.error('bad'); process.exit(3)"]);
    expect(r.code).toBe(3);
    expect(r.stderr).toContain("bad");
  });

  it("kills and reports on timeout", async () => {
    const r = await runProcess(NODE, ["-e", "setTimeout(() => {}, 10000)"], { timeoutMs: 300 });
    expect(r.timedOut).toBe(true);
  });

  it("resolves (not rejects) on spawn failure", async () => {
    const r = await runProcess("definitely-not-a-real-binary-xyz", []);
    expect(r.spawnError).toBeTruthy();
  });

  it("skips accumulation with capture:false but still streams", async () => {
    const chunks: string[] = [];
    const r = await runProcess(NODE, ["-e", "console.log('streamed')"], {
      capture: false,
      onOutput: (_s, c) => chunks.push(c),
    });
    expect(r.stdout).toBe("");
    expect(chunks.join("")).toContain("streamed");
  });

  it("pipes stdin and streams output chunks", async () => {
    const chunks: string[] = [];
    const r = await runProcess(NODE, ["-e", "process.stdin.pipe(process.stdout)"], {
      stdin: "echo-me",
      onOutput: (_s, c) => chunks.push(c),
    });
    expect(r.stdout).toBe("echo-me");
    expect(chunks.join("")).toBe("echo-me");
  });
});
