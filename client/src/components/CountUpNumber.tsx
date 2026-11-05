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
    if (startVal === endVal && animFrameRef.current === null) return;

    const startTime = performance.now();

    // Ease-out cubic: power3.out matching GSAP
    const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

    let currentVal = startVal;
    const update = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / duration);
      const eased = easeOutCubic(progress);
      currentVal = startVal + (endVal - startVal) * eased;

      const formatted = decimals
        ? currentVal.toFixed(decimals)
        : Math.round(currentVal).toLocaleString('en-US');

      setDisplayValue(prefix + formatted + suffix);

      if (progress < 1) {
        animFrameRef.current = requestAnimationFrame(update);
      } else {
        animFrameRef.current = null;
        prevValueRef.current = endVal;
      }
    };

    animFrameRef.current = requestAnimationFrame(update);

    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
      prevValueRef.current = currentVal;
    };
  }, [value, duration, decimals, prefix, suffix]);

  return <span className={className}>{displayValue}</span>;
}
