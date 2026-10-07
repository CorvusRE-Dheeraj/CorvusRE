// The written request for the appraisal district's hearing evidence that
// Texas Property Tax Code §41.461 entitles a protesting owner to — the
// "Request CAD Evidence" stage of the case pipeline (case-pipeline.ts). The
// district must provide it at least 14 days before the ARB hearing once
// asked, which lets the owner see (and rebut) the district's comps in
// advance instead of at the hearing table.

export type CadEvidenceRequestInput = {
  cadName: string | null;
  address: string;
  accountNumber: string | null;
  taxYear: number | null;
  ownerName: string | null;
  replyEmail: string | null;
  today?: Date;
};

export function cadEvidenceRequestSubject(input: CadEvidenceRequestInput): string {
  return `Request for hearing evidence (Tax Code §41.461) — Account ${input.accountNumber ?? "(see below)"}`;
}

export function cadEvidenceRequestLetter(input: CadEvidenceRequestInput): string {
  const date = (input.today ?? new Date()).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const owner = input.ownerName?.trim() || "[Property owner's name]";
  return [
    date,
    "",
    `Chief Appraiser`,
    input.cadName ?? "[Appraisal district]",
    "",
    "Re: Request for evidence under Texas Property Tax Code §41.461",
    `Property: ${input.address}`,
    `Account number: ${input.accountNumber ?? "[account number]"}`,
    `Tax year: ${input.taxYear ?? new Date().getFullYear()}`,
    `Owner: ${owner}`,
    "",
    "I have filed a notice of protest for the property above. Under Texas Property Tax Code §41.461, please provide a copy of the data, schedules, formulas, and all other information the chief appraiser plans to introduce at the hearing to establish any matter at issue, at least 14 days before my hearing.",
    "",
    input.replyEmail
      ? `Please send it to ${input.replyEmail}, or to the mailing address on file for this account.`
      : "Please send it to the mailing address on file for this account.",
    "",
    "Sincerely,",
    owner,
  ].join("\n");
}
