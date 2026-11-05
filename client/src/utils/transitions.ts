'use client';

import gsap from 'gsap';

export const VIEW_BLOCKS_SELECTOR =
  ':scope > .page-head, :scope > div > .page-head, :scope > .panel, :scope > .tabs, :scope > .toolbar, :scope > .strip > *, :scope > .grid > *, :scope > .dgrid > *, :scope > div > .strip > *, :scope > div > .grid > *, :scope > div > .dgrid > *';

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Phase 1: Exit transition - gentle fade-out and upward lift with a 200ms deliberate delay
 * Matching demo folder/entire_website.html line 942500:
 * gsap.to(view, { opacity: 0, y: -8, duration: 0.2, ease: 'power2.in', onComplete: swap });
 */
export function animateViewExit(view: HTMLElement, onComplete: () => void) {
  if (!view || prefersReducedMotion()) {
    onComplete();
    return;
  }
  gsap.killTweensOf(view);
  gsap.to(view, {
    opacity: 0,
    y: -8,
    duration: 0.2,
    ease: 'power2.in',
    onComplete
  });
}

/**
 * Phase 3: Entrance transition - staggered upward float over 700ms with consecutive 0.04s stagger
 * Matching demo folder/entire_website.html function enter(view):
 * gsap.set(view, { opacity: 1, y: 0 });
 * tl.fromTo(blocks, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.7, stagger: 0.04, ease: 'power3.out', clearProps: 'opacity,transform' }, 0.04);
 */
export function animateViewEntrance(view: HTMLElement) {
  if (!view) return null;
  if (prefersReducedMotion()) {
    gsap.set(view, { opacity: 1, y: 0 });
    return null;
  }

  gsap.killTweensOf(view);
  gsap.set(view, { opacity: 1, y: 0 });
  const tl = gsap.timeline({ defaults: { ease: 'expo.out' } });

  const blocks = view.querySelectorAll<HTMLElement>(VIEW_BLOCKS_SELECTOR);
  if (blocks.length > 0) {
    const list = Array.from(blocks).slice(0, 24);
    tl.fromTo(
      list,
      { opacity: 0, y: 12 },
      { opacity: 1, y: 0, duration: 0.7, stagger: 0.04, ease: 'power3.out', clearProps: 'opacity,transform' },
      0.04
    );
  }

  const floats = view.querySelectorAll<HTMLElement>('.hm .map-float, .map-float');
  if (floats.length > 0) {
    tl.fromTo(
      Array.from(floats),
      { opacity: 0, x: (_: any, el: HTMLElement) => (el.getBoundingClientRect().left < window.innerWidth / 2 ? -18 : 18) },
      { opacity: 1, x: 0, duration: 0.8, stagger: 0.05, clearProps: 'opacity,transform' },
      0.15
    );
  }

  return tl;
}
