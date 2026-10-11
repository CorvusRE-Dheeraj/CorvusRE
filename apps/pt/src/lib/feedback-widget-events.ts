// Anything that used to link to the old feedback page (nav tab, profile menu,
// dashboard banner, sign-out prompt) opens the floating FeedbackWidget instead,
// in place — no navigation. The widget listens for this event.
export const OPEN_FEEDBACK_EVENT = "corvuspt:open-feedback";

export function openFeedbackWidget(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(OPEN_FEEDBACK_EVENT));
}
