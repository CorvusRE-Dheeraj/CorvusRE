import { useState } from "react";

const KEY = "corvuspt.textSize";
const SIZES = [
  { id: "100", label: "Normal", sample: "text-sm" },
  { id: "112", label: "Large", sample: "text-base" },
  { id: "125", label: "Extra large", sample: "text-lg" },
];

function apply(v: string) {
  document.documentElement.style.fontSize = v === "100" ? "" : `${v}%`;
}

// Lets people make all text bigger; remembered in this browser (re-applied on load by the head script).
export function TextSizeControl() {
  const [size, setSize] = useState(() => {
    try {
      return localStorage.getItem(KEY) ?? "100";
    } catch {
      return "100";
    }
  });
  function pick(v: string) {
    setSize(v);
    apply(v);
    try {
      localStorage.setItem(KEY, v);
    } catch {
      // harmless
    }
  }
  return (
    <div className="mt-8 card-elev p-6">
      <h2 className="font-semibold">Text size</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Make the text easier to read. This applies on this device.
      </p>
      <div role="radiogroup" aria-label="Text size" className="mt-3 flex flex-wrap gap-2">
        {SIZES.map((s) => (
          <button
            key={s.id}
            type="button"
            role="radio"
            aria-checked={size === s.id}
            onClick={() => pick(s.id)}
            className={`rounded-md border px-4 py-2 ${s.sample} ${
              size === s.id
                ? "border-primary bg-primary text-primary-foreground"
                : "border-input bg-background hover:bg-secondary"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}
