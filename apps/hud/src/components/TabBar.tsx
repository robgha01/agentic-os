/**
 * Dashboard tabs — switch, add, rename (double-click), and remove pages. Each
 * page is its own six-slot arrangement. A single-page workspace hides its remove
 * control so there is always at least one page.
 */
import { useState } from "react";
import type { Page } from "../layout.js";

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
  return (
    <div className="tabs" role="tablist">
      {pages.map((p) => (
        <div key={p.id} className={`tab ${p.id === activeId ? "tab--on" : ""}`}>
          {editing === p.id ? (
            <input
              className="tab__edit"
              autoFocus
              defaultValue={p.name}
              onBlur={(e) => { onRename(p.id, e.target.value.trim() || p.name); setEditing(null); }}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            />
          ) : (
            <button
              className="tab__btn"
              role="tab"
              aria-selected={p.id === activeId}
              onClick={() => onSelect(p.id)}
              onDoubleClick={() => setEditing(p.id)}
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
