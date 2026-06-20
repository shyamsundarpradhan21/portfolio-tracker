'use client';
import { useEffect, useRef, useState } from 'react';

// Count-up. Animates `value` from its previous value to the new one (ease-out),
// calling render(currentNumber) each frame — so it reuses the app's own formatters
// (e.g. render={(n) => <InrC n={n} />}) and nothing about the display changes except
// that the figure ticks. The first value on mount shows instantly (no count-from-0)
// unless `from` is given; thereafter every change animates — that's the liveness on
// a price refresh. Snaps instantly under prefers-reduced-motion.
export default function AnimatedNumber({ value, render, from, duration = 850 }) {
  const init = from != null ? from : value;
  const [disp, setDisp] = useState(init);
  const prev = useRef(init);
  const raf = useRef(0);

  useEffect(() => {
    const target = value;
    const start = prev.current;
    if (target == null || !isFinite(target)) { setDisp(target); prev.current = target; return; }
    const reduce = typeof window !== 'undefined' && window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || start === target || !isFinite(start)) { setDisp(target); prev.current = target; return; }

    const t0 = performance.now();
    const ease = (t) => 1 - Math.pow(1 - t, 4); // ease-out quart — decelerates into the value
    cancelAnimationFrame(raf.current);
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / duration);
      setDisp(start + (target - start) * ease(p));
      if (p < 1) raf.current = requestAnimationFrame(tick);
      else { setDisp(target); prev.current = target; }
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [value, duration]);

  return render ? render(disp) : disp;
}
