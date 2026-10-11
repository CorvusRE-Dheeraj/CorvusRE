import { useCallback, useEffect, useRef, useState } from "react";

// Browser speech for the mock hearing — text-to-speech for the panel and the
// appraiser, speech-to-text for the owner's answers. Everything runs in the
// browser's own speech engine; nothing is recorded or uploaded by CorvusPT.
// Speech recognition exists in Chrome, Edge and Safari; where it doesn't,
// the owner types instead.

type RecognitionResult = { isFinal: boolean; 0: { transcript: string } };
type RecognitionEvent = { resultIndex: number; results: ArrayLike<RecognitionResult> };
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: RecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start: () => void;
  stop: () => void;
};
type RecognitionCtor = new () => Recognition;

const recognitionCtor = (): RecognitionCtor | null => {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

export const canSpeak = () => typeof window !== "undefined" && "speechSynthesis" in window;
export const canListen = () => recognitionCtor() != null;

// Two distinct English voices, so the panel and the appraiser sound different.
export function pickVoices(voices: SpeechSynthesisVoice[]): {
  panel: SpeechSynthesisVoice | null;
  appraiser: SpeechSynthesisVoice | null;
} {
  const en = voices.filter((v) => v.lang?.toLowerCase().startsWith("en"));
  const us = en.filter((v) => v.lang.toLowerCase() === "en-us");
  const pool = us.length >= 2 ? us : en;
  return { panel: pool[0] ?? null, appraiser: pool[1] ?? pool[0] ?? null };
}

export function useSpeech() {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const recognition = useRef<Recognition | null>(null);

  useEffect(() => {
    if (!canSpeak()) return;
    const load = () => setVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", load);
      window.speechSynthesis.cancel();
      recognition.current?.stop();
    };
  }, []);

  const speak = useCallback(
    (text: string, role: "panel" | "appraiser") => {
      if (!canSpeak()) return;
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      const v = pickVoices(voices)[role];
      if (v) u.voice = v;
      u.rate = 1;
      u.pitch = role === "appraiser" ? 0.9 : 1.05;
      u.onstart = () => setSpeaking(true);
      u.onend = () => setSpeaking(false);
      u.onerror = () => setSpeaking(false);
      window.speechSynthesis.speak(u);
    },
    [voices],
  );

  const stopSpeaking = useCallback(() => {
    if (canSpeak()) window.speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  // Dictation: finalized phrases are appended through onText as they arrive.
  const listen = useCallback(
    (onText: (finalText: string) => void, onError?: (msg: string) => void) => {
      const Ctor = recognitionCtor();
      if (!Ctor) return;
      if (canSpeak()) window.speechSynthesis.cancel();
      const r = new Ctor();
      r.lang = "en-US";
      r.continuous = true;
      r.interimResults = false;
      r.onresult = (e) => {
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i];
          if (res.isFinal) onText(res[0].transcript.trim());
        }
      };
      r.onerror = (e) => {
        if (e.error === "not-allowed" || e.error === "service-not-allowed")
          onError?.("Microphone access was blocked — allow it in the browser to answer by voice.");
      };
      r.onend = () => setListening(false);
      recognition.current = r;
      r.start();
      setListening(true);
    },
    [],
  );

  const stopListening = useCallback(() => {
    recognition.current?.stop();
    setListening(false);
  }, []);

  return { speak, stopSpeaking, speaking, listen, stopListening, listening };
}
