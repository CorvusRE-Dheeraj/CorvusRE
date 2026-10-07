import { useEffect, useRef, useState } from "react";

export type SignatureValue = { type: "draw"; data: string } | { type: "type"; data: string };

// Read-only rendering of a saved signature — the same script style SignaturePad
// previews a typed one in, or the drawn PNG itself.
export function SignaturePreview({
  value,
  className,
}: {
  value: SignatureValue;
  className?: string;
}) {
  return value.type === "draw" ? (
    <img src={value.data} alt="Your signature" className={`h-14 w-auto ${className ?? ""}`} />
  ) : (
    <span className={`font-serif text-2xl italic ${className ?? ""}`}>{value.data}</span>
  );
}

// Draw (HTML canvas, exported as a PNG data URL) or Type (plain text, rendered in a
// cursive font as a preview) signature capture — mirrors the two-tab pattern used by
// e-signature flows generally. `onChange` fires with null whenever there's nothing
// signable yet (empty canvas / empty text), so callers can gate their submit button
// on a non-null value rather than tracking their own "has signed" flag.
export function SignaturePad({
  expectedName,
  adoptName,
  onChange,
}: {
  expectedName?: string | null;
  // When given, adds a "Use signature" option (the default) that signs with this
  // name rendered in script — one click, no typing. Stored like a typed signature.
  adoptName?: string;
  onChange: (value: SignatureValue | null) => void;
}) {
  const [mode, setMode] = useState<"adopt" | "draw" | "type">(
    adoptName !== undefined ? "adopt" : "type",
  );
  const [typedName, setTypedName] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const hasDrawnRef = useRef(false);

  useEffect(() => {
    if (mode === "type") {
      onChange(typedName.trim() ? { type: "type", data: typedName.trim() } : null);
    }
    if (mode === "adopt") {
      const name = (adoptName ?? "").trim();
      onChange(name ? { type: "type", data: name } : null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, typedName, adoptName]);

  function getCanvasPoint(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function startDraw(e: React.PointerEvent<HTMLCanvasElement>) {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    drawingRef.current = true;
    const { x, y } = getCanvasPoint(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function draw(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const { x, y } = getCanvasPoint(e);
    ctx.lineTo(x, y);
    ctx.strokeStyle = "#0a2b52";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.stroke();
    hasDrawnRef.current = true;
  }

  function endDraw() {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    onChange(
      hasDrawnRef.current
        ? { type: "draw", data: canvasRef.current!.toDataURL("image/png") }
        : null,
    );
  }

  function clearDraw() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasDrawnRef.current = false;
    onChange(null);
  }

  function switchMode(next: "adopt" | "draw" | "type") {
    setMode(next);
    if (next === "draw") {
      onChange(
        hasDrawnRef.current
          ? { type: "draw", data: canvasRef.current!.toDataURL("image/png") }
          : null,
      );
    }
  }

  return (
    <div>
      <div className="inline-flex rounded-md border border-border p-0.5 text-sm">
        {adoptName !== undefined && (
          <button
            type="button"
            onClick={() => switchMode("adopt")}
            className={`rounded px-3 py-1.5 ${mode === "adopt" ? "bg-accent text-accent-foreground" : "text-muted-foreground"}`}
          >
            Use signature
          </button>
        )}
        <button
          type="button"
          onClick={() => switchMode("draw")}
          className={`rounded px-3 py-1.5 ${mode === "draw" ? "bg-accent text-accent-foreground" : "text-muted-foreground"}`}
        >
          Draw
        </button>
        <button
          type="button"
          onClick={() => switchMode("type")}
          className={`rounded px-3 py-1.5 ${mode === "type" ? "bg-accent text-accent-foreground" : "text-muted-foreground"}`}
        >
          Type
        </button>
      </div>

      {expectedName && (
        <p className="mt-2 text-xs text-muted-foreground">
          Signature must match the legal owner name on record: <strong>{expectedName}</strong>
        </p>
      )}

      {mode === "adopt" ? (
        <div className="mt-2 flex h-24 items-center justify-center rounded-md border border-dashed border-border bg-secondary/30">
          {(adoptName ?? "").trim() ? (
            <span className="font-serif text-3xl italic">{adoptName}</span>
          ) : (
            <span className="text-xs text-muted-foreground">
              Enter your name to generate your signature
            </span>
          )}
        </div>
      ) : mode === "type" ? (
        <div className="mt-2">
          <input
            value={typedName}
            onChange={(e) => setTypedName(e.target.value)}
            placeholder="Type your full legal name"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
          <div className="mt-2 flex h-24 items-center justify-center rounded-md border border-dashed border-border bg-secondary/30">
            {typedName.trim() ? (
              <span className="font-serif text-3xl italic">{typedName}</span>
            ) : (
              <span className="text-xs text-muted-foreground">Your signature will appear here</span>
            )}
          </div>
        </div>
      ) : (
        <div className="mt-2">
          <canvas
            ref={canvasRef}
            width={600}
            height={160}
            onPointerDown={startDraw}
            onPointerMove={draw}
            onPointerUp={endDraw}
            onPointerLeave={endDraw}
            className="h-24 w-full touch-none rounded-md border border-dashed border-border bg-secondary/30"
          />
          <button
            type="button"
            onClick={clearDraw}
            className="mt-1 text-xs text-muted-foreground hover:text-foreground"
          >
            Clear
          </button>
        </div>
      )}
    </div>
  );
}
