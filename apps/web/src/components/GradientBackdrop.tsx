import { motion, useReducedMotion } from "framer-motion";

/**
 * Hero wash.
 *
 * Deliberately restrained: one low-saturation accent glow over the canvas,
 * plus a very faint grid to give the empty state some structure. No rainbow,
 * no competing hues. The content is meant to be the loudest thing on screen.
 */
export function GradientBackdrop({ className }: { className?: string }) {
  const reduce = useReducedMotion();

  return (
    <div className={className} aria-hidden>
      {/* Single accent glow, anchored above the fold. */}
      <motion.div
        className="absolute -top-[24%] left-1/2 h-[68%] w-[92%] -translate-x-1/2 rounded-[50%] blur-[90px]"
        style={{
          background:
            "radial-gradient(closest-side, color-mix(in oklab, var(--c-accent) 30%, transparent), transparent)",
        }}
        animate={reduce ? undefined : { opacity: [0.8, 1, 0.8] }}
        transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
      />

      {/* A wider, neutral halo gives the glow some depth without adding colour. */}
      <div
        className="absolute -top-[10%] left-1/2 h-[46%] w-[120%] -translate-x-1/2 rounded-[50%] blur-[100px]"
        style={{
          background:
            "radial-gradient(closest-side, color-mix(in oklab, var(--c-ink) 8%, transparent), transparent)",
        }}
      />

      {/* Faint structure so an empty canvas doesn't read as unfinished. */}
      <div
        className="absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            "radial-gradient(color-mix(in oklab, var(--c-ink) 12%, transparent) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
          maskImage:
            "radial-gradient(120% 70% at 50% 0%, #000 0%, transparent 72%)",
          WebkitMaskImage:
            "radial-gradient(120% 70% at 50% 0%, #000 0%, transparent 72%)",
        }}
      />

      {/* Fade the wash out before it reaches the content. */}
      <div className="absolute inset-0 bg-[linear-gradient(to_bottom,transparent_0%,var(--c-canvas)_78%)]" />
    </div>
  );
}
