/**
 * Dashboard tabs — switch, add, rename (double-click), and remove pages. Each
 * page is its own six-slot arrangement. A single-page workspace hides its remove
 * control so there is always at least one page.
 */
import { useRef, useState } from "react";
import type { Page } from "../layout.js";

/** id shared with the workspace region so tabs point at the panel they control. */
export const WORKSPACE_PANEL_ID = "workspace-panel";

export function TabBar({
  pages, activeId, onSelect, onAdd, onRename, onRemove,
}: {
  pages: Page[];
  activeId: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRename: (id: string, name: string) => void;
  onRemove: (id: string) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const btnRefs = useRef(new Map<string, HTMLButtonElement>());

  // Arrow keys move between tabs (roving tabindex — only the active tab is in the
  // tab order); Home/End jump to the ends. Selecting also moves focus.
  const onKeyNav = (e: React.KeyboardEvent, idx: number) => {
    let target = idx;
    if (e.key === "ArrowRight") target = (idx + 1) % pages.length;
    else if (e.key === "ArrowLeft") target = (idx - 1 + pages.length) % pages.length;
    else if (e.key === "Home") target = 0;
    else if (e.key === "End") target = pages.length - 1;
    else return;
    e.preventDefault();
    const p = pages[target]!;
    onSelect(p.id);
    btnRefs.current.get(p.id)?.focus();
  };

  return (
    <div className="tabs" role="tablist" aria-label="Dashboard pages">
      {pages.map((p, i) => (
        <div key={p.id} className={`tab ${p.id === activeId ? "tab--on" : ""}`}>
          {editing === p.id ? (
            <input
              className="tab__edit"
              autoFocus
              defaultValue={p.name}
              onBlur={(e) => { onRename(p.id, e.target.value.trim() || p.name); setEditing(null); }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                else if (e.key === "Escape") { e.preventDefault(); setEditing(null); }
              }}
            />
          ) : (
            <button
              className="tab__btn"
              role="tab"
              id={`tab-${p.id}`}
              aria-selected={p.id === activeId}
              aria-controls={WORKSPACE_PANEL_ID}
              tabIndex={p.id === activeId ? 0 : -1}
              ref={(el) => { if (el) btnRefs.current.set(p.id, el); else btnRefs.current.delete(p.id); }}
              onClick={() => onSelect(p.id)}
              onDoubleClick={() => setEditing(p.id)}
              onKeyDown={(e) => onKeyNav(e, i)}
            >
              {p.name}
            </button>
          )}
          {pages.length > 1 ? (
            <button className="tab__x" onClick={() => onRemove(p.id)} aria-label={`Remove ${p.name}`}>✕</button>
          ) : null}
        </div>
      ))}
      <button className="tab__add" onClick={onAdd} aria-label="Add page">＋</button>
    </div>
  );
}
