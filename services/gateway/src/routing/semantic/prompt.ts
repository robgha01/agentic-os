/**
 * Shared prompt construction for the semantic routing path. Both the Anthropic
 * and Ollama adapters render the action catalog the same way so behavior is
 * comparable across brains.
 */
import type { Action } from "@aos/shared";

/** Render the action catalog into a system prompt for intent routing. */
export function buildRouterSystemPrompt(catalog: readonly Action[]): string {
  const lines = catalog.map((a) => {
    const params =
      a.parameters && a.parameters.length > 0
        ? ` Parameters: ${a.parameters
            .map((p) => `${p.name} (${p.type}${p.required ? ", required" : ""})`)
            .join(", ")}.`
        : "";
    return `- ${a.id}: ${a.description}${params}`;
  });

  return [
    "You are the intent router for a local Agentic OS.",
    "Map the user's request to exactly ONE action from the catalog below.",
    "Extract any parameters the chosen action declares.",
    "If nothing fits confidently, choose `unknown`.",
    "",
    "ACTIONS:",
    ...lines,
  ].join("\n");
}

/** Instruction appended for providers that return free-form JSON (e.g. Ollama). */
export const JSON_RESPONSE_INSTRUCTION =
  'Respond with ONLY a JSON object: {"action": string, "confidence": number (0..1), "parameters": object, "reasoning": string}.';
