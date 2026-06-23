/** AI Wire — a terse AI-industry intel brief from the newest `intel` record. */
import { useEffect, useState } from "react";
import type { HudState } from "../../useGateway.js";
import type { WidgetDef, WidgetOptions } from "../_contract.js";
import { Empty } from "../_shared.js";

/** Pull the bullets out of an intel record's "## Wire" section, markdown stripped. */
function wireBullets(body: string): string[] {
  const lines = body.split("\n");
  const start = lines.findIndex((l) => /^##\s+Wire\b/i.test(l));
  if (start === -1) return [];
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i] ?? "")) break;
    const m = (lines[i] ?? "").match(/^\s*[-*]\s+(.*)$/);
    if (m) {
      out.push(
        m[1]!
          .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // links -> label
          .replace(/[*_`]/g, "")
          .trim(),
      );
    }
  }
  return out;
}

function AiWire({ hud, options }: { hud: HudState; options: WidgetOptions }) {
  const max = Number(options.max ?? 8);
  const topic = String(options.topic ?? "").trim();
  const rec = hud.records.find((r) => r.type === "intel");
  const path = rec?.path;
  const fetchDoc = hud.fetchDoc;
  const [bullets, setBullets] = useState<string[]>([]);

  useEffect(() => {
    if (!path) {
      setBullets([]);
      return;
    }
    let alive = true;
    fetchDoc(path)
      .then((d) => alive && d && setBullets(wireBullets(d.body)))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [path, fetchDoc]);

  const run = () => hud.send({ type: "invoke", skillId: "ai-wire", params: topic ? { topic } : {} });

  if (!rec) {
    return (
      <div className="wire">
        <Empty>No wire yet — pull the latest AI-industry signal.</Empty>
        <button className="wire__run" onClick={run}>Run AI Wire</button>
      </div>
    );
  }
  return (
    <div className="wire">
      <button className="wire__head" onClick={() => hud.openDoc(rec.path)} title="Open the full intel record">
        <span className="wire__sub">{rec.title}</span>
        <span className="wire__open">open ↗</span>
      </button>
      <ul className="wire__list">
        {bullets.slice(0, max).map((b, i) => (
          <li key={i}>{b}</li>
        ))}
        {bullets.length === 0 ? <li className="wire__muted">(no bullets parsed)</li> : null}
      </ul>
      <button className="wire__run" onClick={run} title="Refresh the wire">⟳ refresh</button>
    </div>
  );
}

export const widget: WidgetDef = {
  id: "ai-wire",
  name: "AI Wire",
  eyebrow: "morning.intel",
  render: (hud, options) => <AiWire hud={hud} options={options} />,
  options: [
    { key: "topic", label: "Theme", type: "text", default: "", placeholder: "default AI-industry theme", hint: "Passed to the skill on refresh." },
    { key: "max", label: "Max bullets", type: "number", default: 8 },
  ],
  defaultSlot: "left-mid",
};
