/**
 * Bottom command bar — type a request (routed through the intent engine) and a
 * task-progress strip showing in-flight operations. Focusing the input puts the
 * core into its "listening" state.
 */
import { useState } from "react";
import type { HudState } from "../useGateway.js";

export function CommandBar({ hud }: { hud: HudState }) {
  const [text, setText] = useState("");
  const running = hud.operations.filter((o) => o.status === "running").length;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const input = text.trim();
    if (!input) return;
    hud.send({ type: "route", input });
    setText("");
  };

  return (
    <footer className="cmdbar">
      <form className="cmdbar__form" onSubmit={submit}>
        <span className="cmdbar__prompt">▸</span>
        <input
          className="cmdbar__input"
          placeholder="Type a command — e.g. “give me the rundown” or “last 30 days on rust”"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => hud.setListening(true)}
          onBlur={() => hud.setListening(false)}
        />
      </form>
      <div className="cmdbar__progress">
        <div className={`bar ${running > 0 ? "bar--active" : ""}`}>
          <div className="bar__fill" />
        </div>
        <span className="cmdbar__count">{running > 0 ? `${running} active` : "idle"}</span>
      </div>
    </footer>
  );
}
