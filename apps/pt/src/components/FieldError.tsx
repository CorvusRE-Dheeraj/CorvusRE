import { useState } from "react";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Returns a friendly message for an empty or malformed value, or null when fine.
export function requiredError(v: string, what: string): string | null {
  return v.trim() ? null : `Please enter ${what}.`;
}
export function emailError(v: string): string | null {
  if (!v.trim()) return "Please enter your email so we can reply.";
  return EMAIL.test(v.trim())
    ? null
    : "That email doesn't look right. Check for a typo, like name@example.com.";
}

// Shows a field's problem only after the person has left the field, so nobody is scolded mid-typing.
export function useTouched() {
  const [touched, setTouched] = useState(false);
  return { touched, onBlur: () => setTouched(true) };
}

export function FieldError({ id, message }: { id: string; message: string | null }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-xs text-destructive">
      {message}
    </p>
  );
}
