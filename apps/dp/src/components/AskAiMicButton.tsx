import { Mic } from "lucide-react";
import { useSpeechInput } from "@/hooks/use-speech-input";

// One reusable mic affordance for "ask AI a question" text boxes across the
// app (starting with the site-wide AskAiWidget, which had none). Renders
// nothing when the browser doesn't support the Web Speech API (Firefox)
// rather than showing a dead button — same rule the hook's own header
// comment sets.
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
      className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-colors disabled:opacity-50 ${
        speech.listening
          ? "border-destructive/40 bg-destructive/15 text-destructive animate-pulse"
          : "border-input text-muted-foreground hover:text-foreground"
      }`}
    >
      <Mic className="h-4 w-4" />
    </button>
  );
}
