/**
 * Serve the built HUD (apps/hud/dist) over the gateway's HTTP server, so the
 * single binary is the whole app. Assets come from the embedded map when present
 * (packaged binary) and fall back to reading dist from disk in dev. SPA routes
 * (anything without a file extension) resolve to index.html.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import type { ServerResponse } from "node:http";
import { HUD_ASSETS } from "../generated/embedded.js";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".map": "application/json; charset=utf-8",
};

const distDir = (): string =>
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "apps", "hud", "dist");

const hasEmbedded = Object.keys(HUD_ASSETS).length > 0;

/** True if any HUD is available to serve (embedded or on disk). */
export function hudAvailable(): boolean {
  return hasEmbedded || existsSync(join(distDir(), "index.html"));
}

/** Resolve a request path to {type, body}; null if not found. Falls back to index.html for SPA routes. */
function lookup(pathname: string): { type: string; body: Buffer } | null {
  let p = pathname === "/" ? "/index.html" : pathname;
  if (!extname(p)) p = "/index.html"; // SPA route → app shell

  if (hasEmbedded) {
    const hit = HUD_ASSETS[p] ?? HUD_ASSETS["/index.html"];
    if (!hit) return null;
    return { type: hit.type, body: Buffer.from(hit.b64, "base64") };
  }

  // Dev: read from dist on disk, confined to the dist dir.
  const root = distDir();
  const file = normalize(join(root, p));
  const safe = file.startsWith(normalize(root)) ? file : join(root, "index.html");
  const finalPath = existsSync(safe) ? safe : join(root, "index.html");
  if (!existsSync(finalPath)) return null;
  return { type: MIME[extname(finalPath)] ?? "application/octet-stream", body: readFileSync(finalPath) };
}

/** Write the HUD asset for `pathname`, or a 404. Returns true if it handled the request. */
export function serveHud(pathname: string, res: ServerResponse, cors: Record<string, string>): boolean {
  const asset = lookup(pathname);
  if (!asset) {
    res.writeHead(404, cors);
    res.end("not found");
    return true;
  }
  res.writeHead(200, { "content-type": asset.type, ...cors });
  res.end(asset.body);
  return true;
}
