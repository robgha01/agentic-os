/**
 * Tolerant JSON parsing for text-based router brains.
 *
 * `claude -p`, Ollama, and OpenAI-compatible servers return the routing intent
 * as free text that's *supposed* to be a JSON object — but models often wrap it
 * in prose ("Here's the intent:") or ```json fences. A bare `JSON.parse` then
 * throws and the whole route fails. These helpers pull the first balanced JSON
 * object out of the surrounding noise and normalize it into a RouterDecision.
 */
import type { RouterDecision } from "./provider.types.js";

/**
 * Return the first balanced `{…}` object substring, ignoring braces inside
 * string literals — so leading/trailing prose or code fences don't break it.
 * Null when there's no complete object.
 */
export function extractJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') {
      inStr = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

interface RawIntent {
  action?: unknown;
  confidence?: unknown;
  parameters?: unknown;
  reasoning?: unknown;
}

/** Parse a model's text into the raw intent shape, tolerant of fences/prose. */
export function parseIntentJson(text: string): RawIntent | null {
  const candidate = extractJsonObject(text) ?? text.trim();
  try {
    return JSON.parse(candidate) as RawIntent;
  } catch {
    return null;
  }
}

/** Normalize a raw intent object into a validated RouterDecision. */
export function toRouterDecision(raw: RawIntent): RouterDecision {
  return {
    actionId: String(raw.action ?? "unknown"),
    confidence: typeof raw.confidence === "number" ? raw.confidence : 0.5,
    parameters:
      raw.parameters && typeof raw.parameters === "object"
        ? (raw.parameters as Record<string, unknown>)
        : {},
    reasoning: typeof raw.reasoning === "string" ? raw.reasoning : undefined,
  };
}
