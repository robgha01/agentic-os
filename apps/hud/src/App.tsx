/**
 * V.A.U.L.T. — the Agentic OS heads-up display. Top bar, two drag-arrangeable
 * panels flanking the animated core + live signal counter, a bottom command
 * bar, and the device-code sign-in overlay.
 */
import { useCallback, useState } from "react";
import { Core } from "./components/Core.js";
import { TopBar } from "./components/TopBar.js";
import { Panel } from "./components/Panel.js";
import { CommandBar } from "./components/CommandBar.js";
import { AuthPrompt } from "./components/AuthPrompt.js";
import { useGateway } from "./useGateway.js";
import { loadLayout, moveWidget, saveLayout, type Layout, type SlotId } from "./layout.js";

const CORE_LABEL: Record<string, string> = {
  idle: "standing by",
  listening: "listening",
  thinking: "working",
  speaking: "speaking",
};

export function App() {
  const hud = useGateway();
  const [layout, setLayout] = useState<Layout>(() => loadLayout());

  const onMove = useCallback((from: SlotId, to: SlotId) => {
    setLayout((prev) => {
      const next = moveWidget(prev, from, to);
      saveLayout(next);
      return next;
    });
  }, []);

  return (
    <div className="app">
      <TopBar hud={hud} />

      <main className="stage">
        <Panel side="left" slots={["left-top", "left-mid", "left-bottom"]} layout={layout} hud={hud} onMove={onMove} />

        <section className="center">
          <Core state={hud.coreState} />
          <div className="center__state">{CORE_LABEL[hud.coreState]}</div>
          <div className="center__count">{hud.signals.toLocaleString()}</div>
          <div className="center__count-label">signals processed</div>
          {hud.lastSpeech && Date.now() - hud.lastSpeech.at < 8000 ? (
            <div className="center__speech">“{hud.lastSpeech.text}”</div>
          ) : null}
        </section>

        <Panel side="right" slots={["right-top", "right-mid", "right-bottom"]} layout={layout} hud={hud} onMove={onMove} />
      </main>

      <CommandBar hud={hud} />

      {hud.auth ? <AuthPrompt auth={hud.auth} /> : null}
    </div>
  );
}
