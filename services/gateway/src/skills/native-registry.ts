/**
 * Registry of in-gateway TypeScript skill handlers (execution kind "native").
 *
 * Empty by default. Phase 3 registers real handlers (e.g. inboxTriage). A
 * skill whose manifest names a handler not registered here fails fast with a
 * clear error — no silent no-op.
 */
import type { RoutedIntent } from "@aos/shared";

export interface NativeHandlerContext {
  intent: RoutedIntent;
  /** Stream a chunk of output to the operation's event feed. */
  emit: (chunk: string) => void;
}

/** Returns an exit-code-like number (0 = success). */
export type NativeHandler = (ctx: NativeHandlerContext) => Promise<number>;

export const NATIVE_HANDLERS: Record<string, NativeHandler> = {
  // inboxTriage: registered in Phase 3
};
