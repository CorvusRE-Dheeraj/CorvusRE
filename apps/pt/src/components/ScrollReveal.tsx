import { useEffect, useRef, useState, type ReactNode } from "react";

// Fades/slides a child in the first time it scrolls into view, then stops
// watching. Defaults to visible (matching the prerendered/no-JS HTML — this
// app is fully static-prerendered, so an SSR-hidden default would mean a
// crawler or JS-disabled visitor never sees below-the-fold content at all).
// Once mounted, anything already in the viewport just stays visible (no
// flash); anything below the fold hides briefly and reveals on scroll.
// Respects prefers-reduced-motion by never hiding anything in the first place.
export function ScrollReveal({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        } else {
          setVisible(false);
        }
      },
      { threshold: 0.15 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`${className ?? ""} transition-all duration-700 ease-out ${
        visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
      }`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}
