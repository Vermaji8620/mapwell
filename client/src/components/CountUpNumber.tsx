'use client';

import React, { useEffect, useState, useRef } from 'react';

interface CountUpNumberProps {
  value: number;
  duration?: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
}

export function CountUpNumber({
  value,
  duration = 1600,
  decimals = 0,
  prefix = '',
  suffix = '',
  className = 'num'
}: CountUpNumberProps) {
  const [displayValue, setDisplayValue] = useState<string>(() => {
    return prefix + (decimals ? (0).toFixed(decimals) : '0') + suffix;
  });

  const prevValueRef = useRef<number>(0);
  const animFrameRef = useRef<number | null>(null);

  useEffect(() => {
    const startVal = prevValueRef.current;
    const endVal = Number.isFinite(value) ? value : 0;
    const startTime = performance.now();

    // Ease-out cubic: power3.out matching GSAP
    const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

    const update = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / duration);
      const eased = easeOutCubic(progress);
      const current = startVal + (endVal - startVal) * eased;

      const formatted = decimals
        ? current.toFixed(decimals)
        : Math.round(current).toLocaleString('en-US');

      setDisplayValue(prefix + formatted + suffix);

      if (progress < 1) {
        animFrameRef.current = requestAnimationFrame(update);
      } else {
        prevValueRef.current = endVal;
      }
    };

    animFrameRef.current = requestAnimationFrame(update);

    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [value, duration, decimals, prefix, suffix]);

  return <span className={className}>{displayValue}</span>;
}
