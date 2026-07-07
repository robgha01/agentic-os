/**
 * Shared Options form controls. Defined at module scope (never inside a parent
 * component) so their component identity is stable — otherwise React remounts
 * the input on every parent render and drops focus mid-keystroke.
 */
export function Select({ label, value, options, onChange }: {
  label: string; value: string; options: string[]; onChange: (v: string) => void;
}) {
  return (
    <div className="opt__row">
      <span className="opt__key">{label}</span>
      <select className="opt__select" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </div>
  );
}

export function Text({ label, value, placeholder, onChange }: {
  label: string; value: string; placeholder?: string; onChange: (v: string) => void;
}) {
  return (
    <div className="opt__row">
      <span className="opt__key">{label}</span>
      <input className="opt__select" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
