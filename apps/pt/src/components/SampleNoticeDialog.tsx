import { useState } from "react";
import { FileText } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

// A labeled, illustrative layout of a Texas CAD appraisal notice — not a scan of a
// real county's document. Field names/positions follow the standard Texas Comptroller
// "Notice of Appraised Value" format so it's an accurate example of what to upload,
// without presenting any specific county's actual document as if it were live data.
const FIELDS: Array<{ label: string; sample: string }> = [
  { label: "Appraisal District", sample: "Example County Appraisal District" },
  { label: "Property ID / Account Number", sample: "R123456" },
  { label: "Owner Name & Mailing Address", sample: "Example Holdings LLC, 123 Main St" },
  { label: "Situs (Property) Address", sample: "456 Commerce Dr, Example, TX" },
  { label: "Legal Description", sample: "LOT 4 BLK 2 EXAMPLE COMMERCIAL SUBDIVISION" },
  { label: "Prior Year Appraised Value", sample: "$1,050,000" },
  { label: "Current Year Market / Appraised Value", sample: "$1,225,000" },
  { label: "Exemptions", sample: "None / Homestead / Ag, etc." },
  { label: "Protest Deadline", sample: "May 15 (or 30 days after this notice was mailed)" },
];

export function SampleNoticeDialog({
  triggerClassName = "text-muted-foreground hover:text-foreground",
}: {
  // Lets a caller override the trigger's colors when it sits on a background
  // (e.g. the homepage hero's grass) where the default muted-gray text doesn't
  // have enough contrast to read — the underline/icon/label stay the same.
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className={`inline-flex items-center gap-1.5 text-xs underline underline-offset-2 ${triggerClassName}`}
        >
          <FileText className="h-3.5 w-3.5" />
          View sample appraisal notice
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>What a Texas appraisal notice looks like</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Illustrative example only — every county's exact layout varies, but a real notice
          or tax bill will have most of these fields. Upload the page(s) that show these.
        </p>
        <div className="rounded-lg border border-border bg-secondary/30 p-4">
          <div className="grid gap-2.5">
            {FIELDS.map((f) => (
              <div key={f.label} className="grid grid-cols-[1fr_1.2fr] gap-3 text-sm">
                <span className="font-medium text-foreground/80">{f.label}</span>
                <span className="text-muted-foreground italic">{f.sample}</span>
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
