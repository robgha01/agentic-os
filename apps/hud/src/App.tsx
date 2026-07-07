/**
 * V.A.U.L.T. — the Agentic OS heads-up display. Top bar, two drag-arrangeable
 * panels flanking the animated core + live signal counter, a bottom command
 * bar, and the device-code sign-in overlay.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Core } from "./components/Core.js";
import { TopBar, type ViewId } from "./components/TopBar.js";
import { Panel } from "./components/Panel.js";
import { CommandBar } from "./components/CommandBar.js";
import { AuthPrompt } from "./components/AuthPrompt.js";
import { DocViewer } from "./components/DocViewer.js";
import { ContextCards } from "./components/ContextCards.js";
import { Options } from "./components/Options.js";
import { WidgetTray } from "./components/WidgetTray.js";
import { PanelResizer } from "./components/PanelResizer.js";
import { TabBar, WORKSPACE_PANEL_ID } from "./components/TabBar.js";
import { useGateway } from "./useGateway.js";
import {
  loadWorkspace, saveWorkspace, moveWidget, placeWidget, removeWidget,
  addPage, renamePage, removePage, setActivePage,
  activeSlots, unplacedWidgets, type SlotId, type Workspace,
} from "./layout.js";
import type { WidgetId } from "./widget-registry.js";
import { clampAgainstViewport, loadPanelWidths, savePanelWidths, type PanelWidths } from "./panel-size.js";

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

  const onSelectPage = useCallback((id: string) => commit(setActivePage(ws, id)), [ws, commit]);
  const onAddPage = useCallback(() => {
    const id = crypto.randomUUID();
    commit(setActivePage(addPage(ws, id, `Page ${ws.pages.length + 1}`), id));
  }, [ws, commit]);
  const onRenamePage = useCallback((id: string, name: string) => commit(renamePage(ws, id, name)), [ws, commit]);
  const onRemovePage = useCallback((id: string) => commit(removePage(ws, id)), [ws, commit]);

  const coreRef = useRef<HTMLDivElement>(null);

  const [widths, setWidths] = useState<PanelWidths>(() => loadPanelWidths());
  const resizeLeft = useCallback((clientX: number) => {
    setWidths((w) => {
      const next = { ...w, left: clampAgainstViewport(clientX, w.right, window.innerWidth) };
      savePanelWidths(next);
      return next;
    });
  }, []);
  const resizeRight = useCallback((clientX: number) => {
    setWidths((w) => {
      const next = { ...w, right: clampAgainstViewport(window.innerWidth - clientX, w.left, window.innerWidth) };
      savePanelWidths(next);
      return next;
    });
  }, []);
  const nudgeLeft = useCallback((delta: number) => {
    setWidths((w) => {
      const next = { ...w, left: clampAgainstViewport(w.left + delta, w.right, window.innerWidth) };
      savePanelWidths(next);
      return next;
    });
  }, []);
  const nudgeRight = useCallback((delta: number) => {
    setWidths((w) => {
      const next = { ...w, right: clampAgainstViewport(w.right + delta, w.left, window.innerWidth) };
      savePanelWidths(next);
      return next;
    });
  }, []);

  // Re-clamp on viewport shrink so a wide panel never crushes the center Core.
  useEffect(() => {
    const onResize = () => setWidths((w) => {
      const left = clampAgainstViewport(w.left, w.right, window.innerWidth);
      const right = clampAgainstViewport(w.right, left, window.innerWidth);
      if (left === w.left && right === w.right) return w;
      const next = { left, right };
      savePanelWidths(next);
      return next;
    });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const slots = activeSlots(ws);
  const unplaced = unplacedWidgets(ws);

  return (
    <div className="app">
      <TopBar hud={hud} view={view} onNav={setView} />

      {view === "dashboard" ? (
        <div className="dash">
          <TabBar
            pages={ws.pages}
            activeId={ws.activePageId}
            onSelect={onSelectPage}
            onAdd={onAddPage}
            onRename={onRenamePage}
            onRemove={onRemovePage}
          />
          <main
            className="stage"
            role="tabpanel"
            id={WORKSPACE_PANEL_ID}
            aria-labelledby={`tab-${ws.activePageId}`}
            style={{ ["--panel-left" as string]: `${widths.left}px`, ["--panel-right" as string]: `${widths.right}px` }}
          >
            <Panel side="left" slots={["left-top", "left-mid", "left-bottom"]} layout={slots} hud={hud} unplaced={unplaced} onMove={onMove} onAdd={onAdd} onRemove={onRemove} />
            <PanelResizer side="left" width={widths.left} onResize={resizeLeft} onNudge={nudgeLeft} />

            <section className="center">
              <div className="core-stage">
                <Core state={hud.coreState} ref={coreRef} />
                <ContextCards hud={hud} coreRef={coreRef} />
              </div>
              <div className="center__state">{CORE_LABEL[hud.coreState]}</div>
              <div className="center__count">{hud.signals.toLocaleString()}</div>
              <div className="center__count-label">signals processed</div>
              {hud.lastSpeech && Date.now() - hud.lastSpeech.at < 8000 ? (
                <div className="center__speech">“{hud.lastSpeech.text}”</div>
              ) : null}
            </section>

            <PanelResizer side="right" width={widths.right} onResize={resizeRight} onNudge={nudgeRight} />
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
