import type { CountyProtestInfo } from "@/lib/county-protest-info";

// Every real way this county accepts a filing, shown as its own row — never
// collapsed into one "the" method. Shared by CaseDetailModal.tsx
// (CorvusGuidancePanel's county-process detail + DocumentsSection's "How to
// actually file this" block) and PdfFormEditor.tsx (the post-sign filing
// guidance), so none of them can drift out of sync with each other. A
// standalone file (not exported from either consumer) specifically to avoid
// a circular import between the two. Renders nothing for a channel this
// county's real data doesn't confirm — never guesses a filler address or
// "contact us" line to fill an empty row.
export function FilingMethodsList({ countyInfo }: { countyInfo: CountyProtestInfo }) {
  const { filingMethod: fm } = countyInfo;
  const hasAny = fm.online || fm.mail || fm.inPerson || fm.email.available === true;
  if (!hasAny) {
    return <span>No confirmed filing method on file yet — check {countyInfo.cad}'s website.</span>;
  }
  return (
    <div className="grid gap-1.5">
      {fm.online && (
        <div>
          <span className="font-medium text-foreground">Online: </span>
          <a
            href={fm.online.url}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all text-accent hover:underline"
          >
            {fm.online.url}
          </a>
          {fm.online.notes && <span> — {fm.online.notes}</span>}
        </div>
      )}
      {fm.mail && (
        <div>
          <span className="font-medium text-foreground">Mail: </span>
          {fm.mail.address}
          {fm.mail.notes && <span> — {fm.mail.notes}</span>}
        </div>
      )}
      {fm.inPerson && (!fm.mail || fm.inPerson.address !== fm.mail.address) && (
        <div>
          <span className="font-medium text-foreground">In person: </span>
          {fm.inPerson.address}
          {fm.inPerson.notes && <span> — {fm.inPerson.notes}</span>}
        </div>
      )}
      {fm.email.available === true && (
        <div>
          <span className="font-medium text-foreground">Email: </span>
          {fm.email.address ?? "Accepted"}
          {fm.email.notes && <span> — {fm.email.notes}</span>}
        </div>
      )}
      {fm.email.available === false && (
        <div>
          <span className="font-medium text-foreground">Email: </span>
          Not accepted.
        </div>
      )}
    </div>
  );
}
