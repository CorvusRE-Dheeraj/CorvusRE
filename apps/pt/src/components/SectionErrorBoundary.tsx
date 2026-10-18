import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { logClientError, newErrorRef } from "@/lib/client-errors";

// Contains a crash to one section of a page: the section shows a short notice
// (with the same error reference the full-page error screen uses, logged to
// client_errors) and the rest of the page keeps working. Give it a `key` that
// changes with what it wraps (e.g. the open tab) so moving on resets it.
export class SectionErrorBoundary extends Component<
  { children: ReactNode; label?: string },
  { ref: string | null }
> {
  state = { ref: null as string | null };

  static getDerivedStateFromError(): { ref: string } {
    return { ref: newErrorRef() };
  }

  componentDidCatch(error: unknown, _info: ErrorInfo) {
    if (this.state.ref) void logClientError(this.state.ref, error);
  }

  render() {
    if (!this.state.ref) return this.props.children;
    return (
      <div
        role="alert"
        className="mt-4 flex items-start gap-3 rounded-md border border-warning/40 bg-warning/10 p-4 text-sm"
      >
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning-foreground" aria-hidden />
        <div>
          <p className="font-medium">{this.props.label ?? "This section"} couldn&apos;t load.</p>
          <p className="mt-0.5 text-muted-foreground">
            The rest of the page still works. Reload to try again — if it keeps happening, send us
            reference <span className="font-mono">{this.state.ref}</span>.
          </p>
          <button
            type="button"
            onClick={() => this.setState({ ref: null })}
            className="mt-2 text-xs text-accent hover:underline"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }
}
