import { useEffect, useRef, useState } from "react";
import { Mic } from "lucide-react";

// Minimal shape of the two vendor-prefixed globals this API actually ships under —
// there's no official lib.dom.d.ts type for the Web Speech API yet.
type SpeechRecognitionResultLike = { transcript: string };
type SpeechRecognitionEventLike = {
  results: ArrayLike<ArrayLike<SpeechRecognitionResultLike>>;
};
type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

function getSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// Real voice input via the browser's own Web Speech API — not rendered at all in
// browsers that don't support it (Firefox, Safari as of this writing), rather than
// showing a mic icon that would silently do nothing when clicked.
export function MicButton({ onResult }: { onResult: (transcript: string) => void }) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    setSupported(getSpeechRecognition() !== null);
  }, []);

  if (!supported) return null;

  function toggle() {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const SpeechRecognitionCtor = getSpeechRecognition();
    if (!SpeechRecognitionCtor) return;

    const recognition = new SpeechRecognitionCtor();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (e) => {
      const transcript = e.results[0]?.[0]?.transcript;
      if (transcript) onResult(transcript);
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={listening ? "Stop voice input" : "Enter address by voice"}
      aria-pressed={listening}
      title={listening ? "Listening… click to stop" : "Speak your address"}
      className={`grid h-10 w-10 shrink-0 place-items-center rounded-full border transition-colors ${
        listening
          ? "border-accent bg-accent text-accent-foreground animate-pulse"
          : "border-border text-muted-foreground hover:text-foreground hover:border-accent hover:bg-secondary"
      }`}
    >
      <Mic className="h-4 w-4" />
    </button>
  );
}
