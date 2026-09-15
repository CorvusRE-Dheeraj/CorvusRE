// Single source for the phone numbers shown on the Contact page and in the
// site footer, so the display format and the tel: href stay in sync in one
// place instead of being retyped at each call site.
export const CONTACT_PHONES: { display: string; href: string }[] = [
  { display: "+1 (469) 501-9378", href: "tel:+14695019378" },
  { display: "+1 (201) 754-8080", href: "tel:+12017548080" },
];
