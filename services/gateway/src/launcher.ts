/**
 * UI launcher — opens the HUD window per config.ui (engine-agnostic).
 *
 *   launch "app"     → a chromeless Chromium window (--app=URL); falls back to
 *                      the default browser if no Chromium-family browser is found.
 *   launch "browser" → the OS default browser (any engine: Firefox/Safari/…).
 *   launch "none"    → don't open (just print the URL).
 *
 * config.ui.browser selects the Chromium binary for "app" mode: auto | chrome |
 * edge | brave | chromium | firefox | an absolute path. (firefox/safari have no
 * --app flag, so they always open a normal window.)
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

type LaunchMode = "app" | "browser" | "none";

const CHROMIUM_CANDIDATES: Record<string, string[]> = {
  win32: [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe",
  ],
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ],
  linux: [],
};

const LINUX_NAMES = ["google-chrome", "chromium", "chromium-browser", "microsoft-edge", "brave-browser"];

/** Resolve a Chromium-family executable for --app mode, honoring `pref`. */
function findChromium(pref: string): string | null {
  if (pref && pref !== "auto" && pref !== "firefox" && existsSync(pref)) return pref; // explicit path
  const platform = process.platform;
  if (platform === "linux") {
    // Best-effort: let the OS resolve a Chromium-family name via PATH (spawn
    // failures fall back to the default browser in openUi).
    return LINUX_NAMES[0] ?? null;
  }
  const candidates = CHROMIUM_CANDIDATES[platform] ?? [];
  const nameHint =
    pref === "edge" ? "edge" : pref === "brave" ? "brave" : pref === "chromium" ? "chromium" : pref === "chrome" ? "chrome" : "";
  const ordered = nameHint ? [...candidates].sort((a, b) => (b.toLowerCase().includes(nameHint) ? 1 : 0) - (a.toLowerCase().includes(nameHint) ? 1 : 0)) : candidates;
  return ordered.find((p) => existsSync(p)) ?? null;
}

/** Open the OS default browser to `url`. */
function openDefaultBrowser(url: string): void {
  if (process.platform === "win32") spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
  else if (process.platform === "darwin") spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
  else spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
}

/** Open the HUD per config; returns a short description of what it did (for logging). */
export function openUi(url: string, opts: { launch: LaunchMode; browser: string }): string {
  if (opts.launch === "none") return `open ${url} in your browser`;

  if (opts.launch === "app" && opts.browser !== "firefox") {
    const bin = findChromium(opts.browser);
    if (bin) {
      try {
        spawn(bin, [`--app=${url}`, "--new-window"], { detached: true, stdio: "ignore" }).unref();
        return `opened app window via ${bin}`;
      } catch {
        /* fall through to default browser */
      }
    }
  }

  try {
    openDefaultBrowser(url);
    return "opened default browser";
  } catch {
    return `open ${url} in your browser`;
  }
}
