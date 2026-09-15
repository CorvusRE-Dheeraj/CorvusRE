import { createFileRoute } from "@tanstack/react-router";
import { PRIVACY_VERSION } from "@/lib/legal";

export const Route = createFileRoute("/privacy")({
  head: () => ({ meta: [{ title: "Privacy Policy — CorvusDP" }] }),
  component: Privacy,
});

function Privacy() {
  return (
    <div className="container-page py-12 max-w-2xl prose-sm">
      <h1 className="font-serif text-3xl font-semibold">Privacy Policy</h1>
      <p className="mt-1 text-xs text-muted-foreground">Version {PRIVACY_VERSION}</p>
      <div className="mt-6 grid gap-4 text-sm text-muted-foreground">
        <p>
          CorvusDP collects the property and project information you enter to produce permitting and
          design analyses, and — if you create an account — your name, email, phone and company for
          authentication and communication.
        </p>
        <p>
          Anonymous analysis inputs are held in your browser session. If you don't sign up, we may
          retain a lightweight record ("lead") of the project details and any contact information
          you provided so our team can follow up.
        </p>
        <p>
          Authenticated data (projects, permits, checklists, documents, communications) is stored in
          our Supabase database with row-level security so each account only accesses its own
          records.
        </p>
        <p>
          We do not sell personal information. Uploaded documents are stored in a private bucket
          accessible only to your account and CorvusDP staff supporting your project.
        </p>
        <p>
          Request access, correction, or deletion of your data by contacting us through the Contact
          page.
        </p>
      </div>
    </div>
  );
}
