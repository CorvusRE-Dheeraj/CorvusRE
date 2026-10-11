// Scrolls a horizontally scrolling strip so `el` is centred, without moving the page itself
// (unlike scrollIntoView, which can also scroll the window vertically).
export function centerInStrip(bar: HTMLElement | null, el: HTMLElement | null) {
  if (!bar || !el) return;
  const b = bar.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  bar.scrollTo({ left: bar.scrollLeft + (r.left - b.left) - (b.width - r.width) / 2 });
}
