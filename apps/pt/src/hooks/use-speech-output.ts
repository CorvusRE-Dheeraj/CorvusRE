import { useCallback, useEffect, useState } from "react";

// Web Speech API text-to-speech (speechSynthesis) — on-device, free, no
// backend, the read-aloud counterpart to useSpeechInput. Chrome / Edge /
// Safari support it; Firefox's support is partial, so callers hide the
// toggle when `supported` is false. The on/off preference is remembered per
// browser (localStorage).

const STORAGE_KEY = "corvus.tts.enabled";

function ttsSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    "SpeechSynthesisUtterance" in window
  );
}

// The browser's default voice for a given language is picked by the OS/browser and is
// frequently male (e.g. Windows' default "David") — every caller here wants a female voice
// instead, so this is resolved once and shared by every AI read-aloud in the app, not chosen
// per component. Cached at module scope: voices are a browser-wide list, not per-hook-instance.
let cachedVoice: SpeechSynthesisVoice | null | undefined; // undefined = not resolved yet

// A voice's own `name` is the only signal the Web Speech API gives for this (there's no
// standard gender field) — matched against the well-known female system/cloud voices Chrome,
// Edge, and Safari actually ship (Windows' Zira/Jenny/Aria, macOS/iOS's Samantha/Victoria/
// Karen/Moira/Tessa/Fiona, Android/Chrome's Google/Wavenet "female" builds, Amazon Polly's
// Joanna/Salli/Kimberly/Kendra/Ivy on some Chromebooks).
const FEMALE_VOICE_HINT =
  /\b(female|zira|jenny|aria|samantha|victoria|karen|moira|tessa|fiona|susan|linda|hazel|catherine|libby|joanna|salli|kimberly|kendra|ivy|emma|olivia|amy|sonia)\b/i;
const MALE_VOICE_HINT =
  /\b(male|david|mark|guy|george|daniel|alex|fred|tom|ryan|christopher|eric|matthew|justin|kevin)\b/i;

function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    const existing = window.speechSynthesis.getVoices();
    if (existing.length > 0) {
      resolve(existing);
      return;
    }
    // Chrome/Edge populate the list asynchronously on first call — wait for the one real event,
    // with a short timeout fallback for a browser that never fires it.
    const onChange = () => {
      window.speechSynthesis.removeEventListener("voiceschanged", onChange);
      resolve(window.speechSynthesis.getVoices());
    };
    window.speechSynthesis.addEventListener("voiceschanged", onChange);
    setTimeout(() => {
      window.speechSynthesis.removeEventListener("voiceschanged", onChange);
      resolve(window.speechSynthesis.getVoices());
    }, 500);
  });
}

// Pure matching logic, pulled out of the browser-API plumbing above so it's unit-testable
// without a real speechSynthesis implementation (headless/CI browsers commonly report zero
// voices at all, so this can't be verified end-to-end there).
export function pickFemaleVoice<V extends { name: string; lang: string }>(voices: V[]): V | null {
  const english = voices.filter((v) => v.lang.toLowerCase().startsWith("en"));
  const pool = english.length > 0 ? english : voices;
  return (
    pool.find((v) => FEMALE_VOICE_HINT.test(v.name)) ??
    // No name matched either list (an unfamiliar voice set) — still avoid a voice whose name
    // clearly says "male", so an ambiguous one is at least not a known-wrong pick.
    pool.find((v) => !MALE_VOICE_HINT.test(v.name)) ??
    pool[0] ??
    null
  );
}

async function getFemaleVoice(): Promise<SpeechSynthesisVoice | null> {
  if (cachedVoice !== undefined) return cachedVoice;
  const voices = await loadVoices();
  cachedVoice = pickFemaleVoice(voices);
  return cachedVoice;
}

// The answers are MarkdownLite — turn the markup into something that reads
// aloud like a person talking, not "star star", "colon dash dash dash",
// "pipe pipe pipe".
function plainForSpeech(md: string): string {
  const lines = (md ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/^>\s?/gm, "")
    .split("\n");

  const out: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    // Markdown table separator row (|---|:--:|) — never spoken.
    if (/^\|?[\s:|-]+\|?$/.test(line) && line.includes("-")) continue;
    // A table row: read the cells as a natural phrase, not the pipes.
    if (line.startsWith("|") || (line.includes(" | ") && line.split("|").length > 2)) {
      const cells = line
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((c) => c.trim())
        .filter(Boolean);
      if (cells.length > 0) out.push(cells.join(", ") + ".");
      continue;
    }
    // Bullet / numbered list markers → just the text.
    out.push(line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, ""));
  }
  return out
    .join(" ")
    .replace(/\s*[|]\s*/g, ", ")
    .replace(/:--+:?|--+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,])/g, "$1")
    .trim();
}

export function useSpeechOutput() {
  const [supported] = useState(ttsSupported);
  const [enabled, setEnabledState] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [speaking, setSpeaking] = useState(false);

  const cancel = useCallback(() => {
    if (ttsSupported()) window.speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  const setEnabled = useCallback(
    (v: boolean) => {
      setEnabledState(v);
      try {
        localStorage.setItem(STORAGE_KEY, v ? "1" : "0");
      } catch {
        /* private mode / blocked storage — the toggle still works for this session */
      }
      if (!v) cancel();
    },
    [cancel],
  );

  const speak = useCallback((text: string) => {
    if (!ttsSupported()) return;
    const clean = plainForSpeech(text);
    if (!clean) return;
    window.speechSynthesis.cancel();
    void getFemaleVoice().then((voice) => {
      const u = new SpeechSynthesisUtterance(clean.slice(0, 4000));
      u.lang = voice?.lang || "en-US";
      if (voice) u.voice = voice;
      u.rate = 1;
      u.onstart = () => setSpeaking(true);
      u.onend = () => setSpeaking(false);
      u.onerror = () => setSpeaking(false);
      window.speechSynthesis.speak(u);
    });
  }, []);

  // Stop talking if the component unmounts (widget closed, route change).
  useEffect(
    () => () => {
      if (ttsSupported()) window.speechSynthesis.cancel();
    },
    [],
  );

  return { supported, enabled, setEnabled, speaking, speak, cancel };
}
