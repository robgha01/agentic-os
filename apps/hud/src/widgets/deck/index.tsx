/** Command deck — a button per skill, with an inline param form. */
import { useState } from "react";
import type { SkillCard } from "@aos/shared";
import type { HudState } from "../../useGateway.js";
import type { WidgetDef } from "../_contract.js";
import { Empty } from "../_shared.js";

function DeckCard({ card, hud }: { card: SkillCard; hud: HudState }) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const needsForm = card.inputs.length > 0;

  const run = () => {
    const params: Record<string, unknown> = {};
    for (const i of card.inputs) params[i.name] = values[i.name] ?? "";
    hud.send({ type: "invoke", skillId: card.skillId, params });
    setOpen(false);
  };

  return (
    <div className="card">
      <button
        className="card__btn"
        onClick={() => (needsForm ? setOpen((v) => !v) : hud.send({ type: "invoke", skillId: card.skillId }))}
      >
        <span className="card__label">{card.label}</span>
        <span className="card__hint">{needsForm ? (open ? "▾" : "▸") : "run"}</span>
      </button>
      {open && needsForm ? (
        <form
          className="card__form"
          onSubmit={(e) => {
            e.preventDefault();
            run();
          }}
        >
          {card.inputs.map((i) => (
            <input
              key={i.name}
              className="field"
              placeholder={i.label ?? i.name}
              value={values[i.name] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, [i.name]: e.target.value }))}
            />
          ))}
          <button className="card__go" type="submit">run</button>
        </form>
      ) : null}
    </div>
  );
}

function CommandDeck({ hud }: { hud: HudState }) {
  if (hud.skills.length === 0) {
    return <Empty>{hud.status === "online" ? "No command skills available." : "Connecting to gateway…"}</Empty>;
  }
  return (
    <div className="deck">
      {hud.skills.map((c) => (
        <DeckCard key={c.skillId} card={c} hud={hud} />
      ))}
    </div>
  );
}

export const widget: WidgetDef = {
  id: "deck",
  name: "Command deck",
  render: (hud) => <CommandDeck hud={hud} />,
  defaultSlot: "right-top",
};
