import { Mic } from "lucide-react";
import { useSpeechInput } from "@/hooks/use-speech-input";

// One reusable mic affordance for "ask AI a question" text boxes (Module
// Q&A, document Q&A, informal-review Q&A, etc.) — same underlying hook and
// look AskAiWidget.tsx already uses for its own chat input, just extracted
// so those other Ask-AI boxes get it too. Distinct from components/MicButton
// (the homepage's one-shot "speak your address" field, a different existing
// component with a different shape — not something to merge into this one).
// Renders nothing when the browser doesn't support the Web Speech API
// (Firefox) rather than showing a dead button.
//
// onTranscript fills the box live as the caller speaks; onFinal (optional)
// fires once with the full recognized text when they stop talking, for a
// hands-free "speak the question, get the answer" flow — the caller decides
// whether that means auto-submitting.
export function AskAiMicButton({
  onTranscript,
  onFinal,
  disabled,
}: {
  onTranscript: (text: string) => void;
  onFinal?: (text: string) => void;
  disabled?: boolean;
}) {
  const speech = useSpeechInput(onTranscript, { onFinal });
  if (!speech.supported) return null;
  return (
    <button
      type="button"
      onClick={speech.toggle}
      disabled={disabled}
      aria-label={speech.listening ? "Stop listening" : "Speak your question"}
      title={speech.listening ? "Stop listening" : "Speak your question"}
      className={`rounded-md px-2.5 py-1.5 transition-colors disabled:opacity-50 ${
        speech.listening
          ? "bg-destructive/15 text-destructive animate-pulse"
          : "border border-input text-muted-foreground hover:text-foreground"
      }`}
    >
      <Mic className="h-4 w-4" />
    </button>
  );
}
