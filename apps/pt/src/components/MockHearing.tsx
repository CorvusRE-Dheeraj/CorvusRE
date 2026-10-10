import { useEffect, useRef, useState } from "react";
import {
  Gavel,
  Loader2,
  Mic,
  MicOff,
  RotateCcw,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
} from "lucide-react";
import { canListen, canSpeak, useSpeech } from "@/hooks/use-speech";
import { toast } from "sonner";
import type { PropertyRecord } from "@/lib/properties";
import type { ProtestRecord } from "@/lib/protests";
import {
  getDebrief,
  listMockHearings,
  loadSimContext,
  nextTurn,
  saveMockHearing,
  type Debrief,
  type Difficulty,
  type MockHearing as Session,
  type SimContext,
  type Turn,
} from "@/lib/mock-hearing";

const DIFFICULTY: { id: Difficulty; label: string; hint: string }[] = [
  { id: "cooperative", label: "Cooperative", hint: "Fair questions, open to adjusting" },
  { id: "typical", label: "Typical", hint: "Defends the value firmly" },
  { id: "tough", label: "Tough", hint: "Challenges every number" },
];

const SPEAKER: Record<Turn["speaker"], { label: string; style: string }> = {
  panel: { label: "ARB panel", style: "bg-secondary" },
  appraiser: { label: "District appraiser", style: "bg-destructive/10" },
  owner: { label: "You", style: "ml-auto bg-accent/15" },
};

const errMsg = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

function DebriefView({ d }: { d: Debrief }) {
  const tone =
    d.readiness >= 75
      ? "text-success"
      : d.readiness >= 50
        ? "text-warning-foreground"
        : "text-destructive";
  return (
    <div className="grid gap-3 rounded-lg border border-border p-4 text-sm">
      <div className="flex items-baseline gap-2">
        <span className={`font-serif text-3xl font-semibold ${tone}`}>{d.readiness}</span>
        <span className="text-muted-foreground">/100 hearing readiness</span>
      </div>
      {d.summary && <p>{d.summary}</p>}
      {d.strengths.length > 0 && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-success">
            What held up
          </div>
          <ul className="mt-1 grid gap-0.5">
            {d.strengths.map((s) => (
              <li key={s}>· {s}</li>
            ))}
          </ul>
        </div>
      )}
      {d.gaps.length > 0 && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-warning-foreground">
            Where the district found gaps
          </div>
          <ul className="mt-1 grid gap-0.5">
            {d.gaps.map((s) => (
              <li key={s}>· {s}</li>
            ))}
          </ul>
        </div>
      )}
      {d.answersToStrengthen.length > 0 && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Stronger answers to consider
          </div>
          <div className="mt-1 grid gap-2">
            {d.answersToStrengthen.map((a) => (
              <div key={a.question} className="rounded-md bg-secondary/50 p-2">
                <div className="text-xs font-medium">Q: {a.question}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  A possible answer: &ldquo;{a.strongerAnswer}&rdquo;
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {d.evidenceToBring.length > 0 && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Evidence that would answer the gaps
          </div>
          <ul className="mt-1 grid gap-0.5">
            {d.evidenceToBring.map((s) => (
              <li key={s}>· {s}</li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">
        A practice debrief from Corvus AI&apos;s analysis of this run — not a prediction of how the
        real panel will rule.
      </p>
    </div>
  );
}

// Mock ARB hearing: the owner practices against an AI district appraiser and
// panel grounded in this case's own facts (hearing-simulator edge function),
// then gets a debrief. Sessions are saved so a run can be reviewed later.
export function MockHearing({
  userId,
  property,
  protest,
  evidenceFiles,
}: {
  userId: string;
  property: PropertyRecord;
  protest: ProtestRecord;
  evidenceFiles: string[];
}) {
  const [past, setPast] = useState<Session[]>([]);
  const [difficulty, setDifficulty] = useState<Difficulty>("typical");
  const [context, setContext] = useState<SimContext | null>(null);
  const [session, setSession] = useState<{
    id: string | null;
    transcript: Turn[];
    debrief: Debrief | null;
    over: boolean;
  } | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState<"turn" | "debrief" | null>(null);
  const [viewing, setViewing] = useState<Session | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  // Voice and video practice: the panel and appraiser speak their lines, the
  // owner can answer by microphone, and a camera self-view shows how they
  // come across. All in the browser — nothing is recorded or uploaded.
  const { speak, stopSpeaking, speaking, listen, stopListening, listening } = useSpeech();
  const [support, setSupport] = useState({ speak: false, listen: false, camera: false });
  const [voice, setVoice] = useState(false);
  const [camera, setCamera] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    setSupport({
      speak: canSpeak(),
      listen: canListen(),
      camera: typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia,
    });
  }, []);

  useEffect(() => {
    if (!camera) return;
    let stream: MediaStream | null = null;
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({ video: true, audio: false })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        if (videoRef.current) videoRef.current.srcObject = s;
      })
      .catch(() => {
        toast.error("Camera access was blocked — allow it in the browser to see yourself.");
        setCamera(false);
      });
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [camera]);

  const say = (t: Turn) => {
    if (voice && t.speaker !== "owner") speak(t.text, t.speaker);
  };

  function toggleMic() {
    if (listening) return stopListening();
    listen(
      (text) => setInput((prev) => (prev ? `${prev} ${text}` : text)),
      (msg) => toast.error(msg),
    );
  }

  useEffect(() => {
    listMockHearings(protest.id)
      .then(setPast)
      .catch(() => {});
  }, [protest.id]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [session?.transcript.length]);

  async function persist(next: { id: string | null; transcript: Turn[]; debrief: Debrief | null }) {
    try {
      return await saveMockHearing(userId, protest.id, { ...next, difficulty });
    } catch {
      return next.id; // practice still works if saving fails
    }
  }

  async function start() {
    setBusy("turn");
    setViewing(null);
    try {
      let ctx: SimContext;
      if (context) ctx = context;
      else {
        ctx = await loadSimContext(property, protest, evidenceFiles);
        setContext(ctx);
      }
      const { turn } = await nextTurn(ctx, [], difficulty);
      const transcript = [turn];
      say(turn);
      const id = await persist({ id: null, transcript, debrief: null });
      setSession({ id, transcript, debrief: null, over: false });
    } catch (e) {
      toast.error(errMsg(e, "Could not start the mock hearing."));
    } finally {
      setBusy(null);
    }
  }

  async function respond() {
    if (!session || !context || !input.trim()) return;
    stopListening();
    const transcript: Turn[] = [...session.transcript, { speaker: "owner", text: input.trim() }];
    setSession({ ...session, transcript });
    setInput("");
    setBusy("turn");
    try {
      const { turn, phase } = await nextTurn(context, transcript, difficulty);
      const next = [...transcript, turn];
      say(turn);
      const id = await persist({ id: session.id, transcript: next, debrief: null });
      setSession({ id, transcript: next, debrief: null, over: phase === "done" });
    } catch (e) {
      toast.error(errMsg(e, "The simulator didn't respond. Try again."));
      setSession({ ...session, transcript: session.transcript });
      setInput(transcript[transcript.length - 1].text);
    } finally {
      setBusy(null);
    }
  }

  async function debrief() {
    if (!session || !context) return;
    stopSpeaking();
    stopListening();
    setBusy("debrief");
    try {
      const d = await getDebrief(context, session.transcript);
      await persist({ id: session.id, transcript: session.transcript, debrief: d });
      setSession({ ...session, debrief: d, over: true });
      listMockHearings(protest.id)
        .then(setPast)
        .catch(() => {});
    } catch (e) {
      toast.error(errMsg(e, "Could not build the debrief."));
    } finally {
      setBusy(null);
    }
  }

  const ownerTurns = session?.transcript.filter((t) => t.speaker === "owner").length ?? 0;

  return (
    <div id="case-mock-hearing" className="mt-5 border-t border-border pt-5">
      <div className="flex items-center gap-2">
        <Gavel className="h-4 w-4 text-accent" aria-hidden="true" />
        <h2 className="text-sm font-semibold">Mock ARB hearing</h2>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Practice against an AI district appraiser and review panel that argue from this case&apos;s
        own record, comparables and evidence. Then get a debrief on where your presentation held up.
      </p>

      {(support.speak || support.camera) && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          {support.speak && (
            <button
              type="button"
              onClick={() => {
                if (voice) stopSpeaking();
                setVoice(!voice);
              }}
              aria-pressed={voice}
              className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 ${voice ? "border-accent bg-accent/10" : "border-border"}`}
            >
              {voice ? (
                <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <VolumeX className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              Voice {voice ? "on" : "off"}
            </button>
          )}
          {support.camera && (
            <button
              type="button"
              onClick={() => setCamera(!camera)}
              aria-pressed={camera}
              className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 ${camera ? "border-accent bg-accent/10" : "border-border"}`}
            >
              {camera ? (
                <Video className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <VideoOff className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              Camera {camera ? "on" : "off"}
            </button>
          )}
          {speaking && (
            <button
              type="button"
              onClick={stopSpeaking}
              className="text-muted-foreground underline"
            >
              Stop speaking
            </button>
          )}
          <span className="text-muted-foreground">
            Practice out loud — nothing is recorded or saved except the text transcript.
          </span>
        </div>
      )}

      {camera && (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          aria-label="Your camera self-view"
          className="mt-3 aspect-video w-full max-w-xs -scale-x-100 rounded-lg border border-border bg-black object-cover"
        />
      )}

      {!session && (
        <div className="mt-3 grid gap-3">
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Appraiser style">
            {DIFFICULTY.map((d) => (
              <button
                key={d.id}
                type="button"
                role="radio"
                aria-checked={difficulty === d.id}
                onClick={() => setDifficulty(d.id)}
                className={`rounded-md border px-3 py-1.5 text-left text-xs ${
                  difficulty === d.id ? "border-accent bg-accent/10" : "border-border"
                }`}
              >
                <div className="font-semibold">{d.label}</div>
                <div className="text-muted-foreground">{d.hint}</div>
              </button>
            ))}
          </div>
          <div>
            <button
              type="button"
              onClick={start}
              disabled={busy != null}
              className="btn-primary btn-primary-hover text-sm disabled:opacity-60"
            >
              {busy ? "Opening the hearing…" : "Start a practice hearing"}
            </button>
          </div>
          {past.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-muted-foreground">Past practice runs</div>
              <ul className="mt-1 grid gap-1">
                {past.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => setViewing(viewing?.id === s.id ? null : s)}
                      className="text-xs underline-offset-2 hover:underline"
                    >
                      {new Date(s.createdAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}{" "}
                      · {s.difficulty}
                      {s.debrief ? ` · readiness ${s.debrief.readiness}/100` : " · no debrief"}
                    </button>
                  </li>
                ))}
              </ul>
              {viewing?.debrief && (
                <div className="mt-2">
                  <DebriefView d={viewing.debrief} />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {session && (
        <div className="mt-3 grid gap-3">
          <div
            className="grid max-h-[28rem] gap-2 overflow-y-auto rounded-lg border border-border p-3"
            aria-live="polite"
          >
            {session.transcript.map((t, i) => (
              <div
                key={i}
                className={`max-w-[85%] rounded-lg px-3 py-2 ${SPEAKER[t.speaker].style}`}
              >
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {SPEAKER[t.speaker].label}
                </div>
                <div className="text-sm">{t.text}</div>
              </div>
            ))}
            {busy === "turn" && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> The panel is
                listening…
              </div>
            )}
            <div ref={endRef} />
          </div>

          {!session.over && !session.debrief && (
            <div className="grid gap-2">
              <label htmlFor="mock-answer" className="sr-only">
                Your answer
              </label>
              <textarea
                id="mock-answer"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void respond();
                }}
                rows={3}
                maxLength={2000}
                placeholder={
                  ownerTurns === 0
                    ? "Present your case: the value you're requesting and the evidence behind it…"
                    : "Answer the question…"
                }
                className="w-full rounded-md border border-input bg-background p-2 text-sm"
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={respond}
                  disabled={busy != null || !input.trim()}
                  className="btn-primary btn-primary-hover text-sm disabled:opacity-60"
                >
                  Respond
                </button>
                {support.listen && (
                  <button
                    type="button"
                    onClick={toggleMic}
                    aria-pressed={listening}
                    className={`btn-outline flex items-center gap-1.5 text-sm ${listening ? "border-destructive text-destructive" : ""}`}
                  >
                    {listening ? (
                      <MicOff className="h-3.5 w-3.5" aria-hidden="true" />
                    ) : (
                      <Mic className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    {listening ? "Stop dictating" : "Answer by voice"}
                  </button>
                )}
                {ownerTurns > 0 && (
                  <button
                    type="button"
                    onClick={debrief}
                    disabled={busy != null}
                    className="btn-outline text-sm disabled:opacity-60"
                  >
                    End and get the debrief
                  </button>
                )}
              </div>
            </div>
          )}

          {session.over && !session.debrief && (
            <button
              type="button"
              onClick={debrief}
              disabled={busy != null}
              className="btn-primary btn-primary-hover w-fit text-sm disabled:opacity-60"
            >
              {busy === "debrief" ? "Reviewing your hearing…" : "Get the debrief"}
            </button>
          )}

          {session.debrief && <DebriefView d={session.debrief} />}

          {(session.debrief || session.over) && (
            <button
              type="button"
              onClick={() => {
                stopSpeaking();
                setSession(null);
              }}
              className="btn-outline flex w-fit items-center gap-1.5 text-sm"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Practice again
            </button>
          )}
        </div>
      )}
    </div>
  );
}
