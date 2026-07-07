/**
 * V.A.U.L.T. — the Agentic OS heads-up display. Top bar, two drag-arrangeable
 * panels flanking the animated core + live signal counter, a bottom command
 * bar, and the device-code sign-in overlay.
 */
import { useCallback, useState } from "react";
import { Core } from "./components/Core.js";
import { TopBar, type ViewId } from "./components/TopBar.js";
import { Panel } from "./components/Panel.js";
import { CommandBar } from "./components/CommandBar.js";
import { AuthPrompt } from "./components/AuthPrompt.js";
import { DocViewer } from "./components/DocViewer.js";
import { ContextCards } from "./components/ContextCards.js";
import { Options } from "./components/Options.js";
import { WidgetTray } from "./components/WidgetTray.js";
import { useGateway } from "./useGateway.js";
import {
  loadWorkspace, saveWorkspace, moveWidget, placeWidget, removeWidget,
  activeSlots, unplacedWidgets, type SlotId, type Workspace,
} from "./layout.js";
import type { WidgetId } from "./widget-registry.js";

const CORE_LABEL: Record<string, string> = {
  idle: "standing by",
  listening: "listening",
  thinking: "working",
  speaking: "speaking",
};

export function App() {
  const hud = useGateway();
  const [view, setView] = useState<ViewId>("dashboard");
  const [ws, setWs] = useState<Workspace>(() => loadWorkspace());
  const commit = useCallback((next: Workspace) => {
    saveWorkspace(next);
    setWs(next);
  }, []);

  const onMove = useCallback((from: SlotId, to: SlotId) => commit(moveWidget(ws, from, to)), [ws, commit]);
  const onAdd = useCallback((slot: SlotId, widget: WidgetId) => commit(placeWidget(ws, slot, widget)), [ws, commit]);
  const onRemove = useCallback((slot: SlotId) => commit(removeWidget(ws, slot)), [ws, commit]);

  const slots = activeSlots(ws);
  const unplaced = unplacedWidgets(ws);

  return (
    <div className="app">
      <TopBar hud={hud} view={view} onNav={setView} />

      {view === "dashboard" ? (
        <div className="dash">
          <main className="stage">
            <Panel side="left" slots={["left-top", "left-mid", "left-bottom"]} layout={slots} hud={hud} unplaced={unplaced} onMove={onMove} onAdd={onAdd} onRemove={onRemove} />

            <section className="center">
              <div className="core-stage">
                <Core state={hud.coreState} />
                <ContextCards hud={hud} />
              </div>
              <div className="center__state">{CORE_LABEL[hud.coreState]}</div>
              <div className="center__count">{hud.signals.toLocaleString()}</div>
              <div className="center__count-label">signals processed</div>
              {hud.lastSpeech && Date.now() - hud.lastSpeech.at < 8000 ? (
                <div className="center__speech">“{hud.lastSpeech.text}”</div>
              ) : null}
            </section>

            <Panel side="right" slots={["right-top", "right-mid", "right-bottom"]} layout={slots} hud={hud} unplaced={unplaced} onMove={onMove} onAdd={onAdd} onRemove={onRemove} />
          </main>

          <CommandBar hud={hud} />
          <WidgetTray unplaced={unplaced} />
        </div>
      ) : (
        <Options hud={hud} />
      )}

      {hud.openDocPath ? <DocViewer hud={hud} path={hud.openDocPath} /> : null}
      {hud.auth ? <AuthPrompt auth={hud.auth} /> : null}
    </div>
  );
}
