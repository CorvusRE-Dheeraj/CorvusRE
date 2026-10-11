import { describe, expect, it } from "vitest";
import {
  corpus,
  extractLinks,
  groundedEmail,
  groundedPhone,
  groundedUrl,
  htmlToText,
} from "../../../../supabase/pt/functions/_shared/web-retrieval";

const html = `<html><head><script>var x=1</script><style>p{}</style></head><body>
<h1>Protests</h1><p>File online at our <a href="/eFile/">Online Protest</a> portal.</p>
<p>Questions: call (512) 268-2522 or email <a href="mailto:protests@hayscad.com">us</a>.</p>
<a href="https://www.hayscad.com/forms/50-132.pdf">Notice of Protest (PDF)</a>
</body></html>`;

const base = new URL("https://hayscad.com/");
const page = { url: base.toString(), text: htmlToText(html), links: extractLinks(html, base) };
const c = corpus([page]);

describe("web retrieval — reading", () => {
  it("keeps the page's words, drops scripts and styles", () => {
    expect(page.text).toMatch(/File online at our Online Protest portal/);
    expect(page.text).not.toMatch(/var x/);
  });

  it("resolves links against the page", () => {
    expect(page.links).toContainEqual({
      url: "https://hayscad.com/eFile/",
      label: "Online Protest",
    });
    expect(page.links.some((l) => l.url === "mailto:protests@hayscad.com")).toBe(true);
  });
});

describe("web retrieval — the AI's answers must be grounded in what was fetched", () => {
  it("keeps a URL that was on the page, matching loosely on scheme/www/trailing slash", () => {
    expect(groundedUrl("http://www.hayscad.com/eFile", c)).toBe("https://hayscad.com/eFile/");
  });

  it("drops a URL that never appeared", () => {
    expect(groundedUrl("https://hayscad.com/invented-portal", c)).toBeNull();
  });

  it("keeps only emails that appeared (mailto or text)", () => {
    expect(groundedEmail("Protests@HaysCAD.com", c)).toBe("protests@hayscad.com");
    expect(groundedEmail("arb@hayscad.com", c)).toBeNull();
  });

  it("keeps only phone numbers whose digits appeared", () => {
    expect(groundedPhone("512-268-2522", c)).toBe("512-268-2522");
    expect(groundedPhone("512-555-0100", c)).toBeNull();
  });
});
