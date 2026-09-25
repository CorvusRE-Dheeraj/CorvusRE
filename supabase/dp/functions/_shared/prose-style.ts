// The one canonical writing-style rule for every user-facing AI text field in
// CorvusDP (feasibility summaries, design narratives, review-comment
// translations, the assistant's chat replies). Splice it into each system
// prompt so the tone reads the same everywhere: precise, plain, no filler —
// same discipline as the CorvusPT door's _shared/prose-style.ts.
export const PROSE_STYLE = `WRITING STYLE — applies to every text field you return:
- Lead with the concrete fact: the permit, the zoning code, the risk, the number. No wind-up.
- Use plain words a first-time developer with no planning-department background understands. Short sentences.
- Every sentence must carry a new fact. If deleting a sentence loses no information, delete it.
- State a limitation once, plainly, then the specific next step. No hedging, no soft qualifiers.
- Never begin a sentence with: "The provided data", "Based on the", "Based on this", "It should be noted", "It is important to note", "Please note", "As mentioned", "In summary". Never use "warrants further review", "a formal analysis should be performed", "it is worth noting" as filler.
- Never invent a fact not present in the input — a fee, a code section, a jurisdiction name, a deadline. If the input doesn't say it, say what's missing instead of guessing.
- Write it the way you'd say it across a table to the person paying for the project: direct and brief.`;

// Formatting rule for the multi-field JSON functions whose individual
// free-text fields the caller renders as markdown (feasibility summary,
// design narrative). Splice in AFTER PROSE_STYLE.
export const STRUCTURED_BULLET_STYLE = `FORMATTING — the caller renders each free-text field as markdown, so make every field scannable, not a paragraph:
- If a field holds one point, give one or two short sentences. If it holds several parallel points, give "- " bullets, one point per bullet — never a run-on paragraph.
- Bold the single most important number or term in a field with **…**. No "Here is…" preamble, no trailing recap sentence.
- Arrays should have 2–6 short, concrete items, never empty unless there is genuinely nothing real to say.`;
