/**
 * Live detection of model-runtime availability — used at gateway boot to build
 * the router brain and seed the dispatcher's selection context.
 */
import type { ModelRuntimeContext } from "@aos/shared";
import { config } from "../../../config/agentic-os.config.js";

export async function detectRuntime(): Promise<ModelRuntimeContext> {
  let ollamaReachable = false;
  try {
    const res = await fetch(`${config.ollama.baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(800),
    });
    ollamaReachable = res.ok;
  } catch {
    ollamaReachable = false;
  }

  return {
    networkUp: true,
    anthropicKeyPresent: Boolean(process.env[config.anthropic.apiKeyEnv]),
    ollamaReachable,
  };
}
