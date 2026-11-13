// The homepage hero's backdrop: a calm, modern abstract field — soft brand-
// colour light (emerald and a little sky blue) over a faint dotted grid that
// fades out toward the edges. Purely decorative (aria-hidden, no pointer
// events); replaced the illustrated clouds / sun / trees / people scene to give
// the landing page the look of a current AI product.
export function HeroBackground() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      {/* base wash */}
      <div className="absolute inset-0 bg-gradient-to-b from-[oklch(0.985_0.01_163)] via-background to-background dark:from-[oklch(0.2_0.03_200)]" />
      {/* soft light */}
      <div className="hero-sun-glow absolute -top-40 left-1/2 h-[36rem] w-[60rem] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,oklch(0.8_0.12_163/0.35),transparent)] blur-2xl" />
      <div className="absolute -right-40 top-24 h-[28rem] w-[28rem] rounded-full bg-[radial-gradient(closest-side,oklch(0.85_0.08_230/0.35),transparent)] blur-2xl" />
      <div className="absolute -left-40 bottom-0 h-[24rem] w-[24rem] rounded-full bg-[radial-gradient(closest-side,oklch(0.88_0.08_163/0.3),transparent)] blur-2xl" />
      {/* faint dotted grid, faded toward the edges */}
      <div
        className="absolute inset-0 opacity-[0.55] dark:opacity-25"
        style={{
          backgroundImage: "radial-gradient(oklch(0.55 0.02 250 / 0.28) 1px, transparent 1px)",
          backgroundSize: "22px 22px",
          maskImage: "radial-gradient(ellipse 70% 60% at 50% 40%, black 30%, transparent 75%)",
          WebkitMaskImage:
            "radial-gradient(ellipse 70% 60% at 50% 40%, black 30%, transparent 75%)",
        }}
      />
    </div>
  );
}
