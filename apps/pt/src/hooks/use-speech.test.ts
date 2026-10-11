import { describe, expect, it } from "vitest";
import { pickVoices } from "./use-speech";

const v = (name: string, lang: string) => ({ name, lang }) as SpeechSynthesisVoice;

describe("pickVoices", () => {
  it("gives the panel and the appraiser different US English voices", () => {
    const r = pickVoices([v("Fr", "fr-FR"), v("A", "en-US"), v("B", "en-GB"), v("C", "en-US")]);
    expect(r.panel?.name).toBe("A");
    expect(r.appraiser?.name).toBe("C");
  });

  it("falls back to any English voice, then shares one", () => {
    expect(pickVoices([v("A", "en-GB"), v("B", "en-AU")]).appraiser?.name).toBe("B");
    const one = pickVoices([v("A", "en-US")]);
    expect(one.appraiser?.name).toBe("A");
    expect(pickVoices([]).panel).toBeNull();
  });
});
