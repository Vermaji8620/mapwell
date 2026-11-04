'use client';

import React, { useEffect, useState, useRef } from 'react';
import gsap from 'gsap';

export interface LoginShowcaseMapProps {
  countyName?: string;
  tractCount?: number;
  className?: string;
}

let cachedSvgText: string | null = null;

// Exact 7 SVI vulnerability quantile bin colors from the prototype
const SVI_RAMP_COLORS = [
  'rgb(159, 183, 203)',
  'rgb(201, 229, 251)',
  'rgb(155, 205, 246)',
  'rgb(111, 177, 239)',
  'rgb(69, 144, 227)',
  'rgb(40, 103, 203)',
  'rgb(27, 74, 155)',
];

export function LoginShowcaseMap({
  countyName = 'King County, WA',
  tractCount = 398,
  className = '',
}: LoginShowcaseMapProps) {
  const sectionRef = useRef<HTMLElement>(null);
  const mapMountRef = useRef<HTMLDivElement>(null);

  const [displayCounty, setDisplayCounty] = useState(countyName);
  const [displayTracts, setDisplayTracts] = useState(tractCount);
  const [isLoaded, setIsLoaded] = useState(false);

  // Synchronize when parent props change
  useEffect(() => {
    setDisplayCounty(countyName);
    setDisplayTracts(tractCount);
  }, [countyName, tractCount]);

  // Entrance animations for UI floating cards and caps
  useEffect(() => {
    if (!sectionRef.current) return;

    const ctx = gsap.context(() => {
      gsap.from('.lg-float, .lg-copy, .lg-caps', {
        y: 16,
        opacity: 0,
        duration: 0.7,
        stagger: 0.1,
        delay: 0.4,
        ease: 'power3.out',
        clearProps: 'opacity,transform',
      });
    }, sectionRef);

    return () => ctx.revert();
  }, []);

  // Fetch SVG and mount interactive zoom handlers
  useEffect(() => {
    let isCancelled = false;

    async function loadAndMount() {
      try {
        if (!cachedSvgText) {
          const res = await fetch('/mapwell-login-map.svg');
          cachedSvgText = await res.text();
        }

        if (isCancelled || !mapMountRef.current) return;

        // Mount SVG directly into the isolated leaf node to prevent React DOM reconciliation collisions
        mapMountRef.current.innerHTML = cachedSvgText;
        setIsLoaded(true);

        const svg = mapMountRef.current.querySelector('svg');
        if (!svg) return;

        const rootG = svg.querySelector('g');
        if (!rootG) return;

        const counties = svg.querySelectorAll<SVGPathElement>('.county');
        const pulseMarkers = svg.querySelectorAll<SVGGElement>('.pulse-m');
        let selectedPath: SVGPathElement | null = null;

        function resetZoom() {
          if (selectedPath) {
            selectedPath.classList.remove('sel');
            selectedPath = null;
          }

          rootG!.style.transition = 'transform 0.65s cubic-bezier(0.16, 1, 0.3, 1)';
          rootG!.style.transform = 'none';

          pulseMarkers.forEach((pm) => {
            pm.style.transition = 'transform 0.65s cubic-bezier(0.16, 1, 0.3, 1)';
            pm.style.transform = 'scale(1)';
            pm.style.transformOrigin = 'center';
          });
        }

        function handleCountyClick(pathEl: SVGPathElement) {
          if (selectedPath === pathEl) {
            resetZoom();
            return;
          }

          if (selectedPath) {
            selectedPath.classList.remove('sel');
          }
          pathEl.classList.add('sel');
          selectedPath = pathEl;

          // Obtain bounding box using native SVG geometry
          const bbox = pathEl.getBBox();
          const s = Math.min(24, 0.75 / Math.max(bbox.width / 975, bbox.height / 610));
          const tx = 975 / 2 - s * (bbox.x + bbox.width / 2);
          const ty = 610 / 2 - s * (bbox.y + bbox.height / 2);

          rootG!.style.transition = 'transform 0.9s cubic-bezier(0.16, 1, 0.3, 1)';
          rootG!.style.transformOrigin = '0 0';
          rootG!.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;

          pulseMarkers.forEach((pm) => {
            pm.style.transition = 'transform 0.9s cubic-bezier(0.16, 1, 0.3, 1)';
            pm.style.transform = `scale(${1 / s})`;
            pm.style.transformOrigin = 'center';
          });
        }

        counties.forEach((pathEl) => {
          pathEl.style.cursor = 'pointer';
          pathEl.addEventListener('click', (e) => {
            e.stopPropagation();
            handleCountyClick(pathEl);
          });
        });

        svg.addEventListener('click', (e) => {
          const target = e.target as Element;
          if (
            target === svg ||
            target.tagName === 'svg' ||
            target.classList.contains('nation-b') ||
            target.classList.contains('state-b')
          ) {
            resetZoom();
          }
        });
      } catch (err) {
        console.error('Failed to mount interactive map', err);
      }
    }

    loadAndMount();

    return () => {
      isCancelled = true;
      if (mapMountRef.current) {
        mapMountRef.current.innerHTML = '';
      }
    };
  }, [countyName, tractCount]);

  return (
    <section ref={sectionRef} className={`lg-side ${className}`} aria-hidden="true">
      <div className="lg-copy">
        <h2>Census tract insight for every community you serve</h2>
        <p>
          Map social determinants, disease incidence and program use, find underserved
          neighborhoods, and turn findings into assessments.
        </p>
      </div>

      <div id="lg-map" className="map-shell">
        <div
          className={`map-skel skeleton ${isLoaded ? 'done' : ''}`}
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            opacity: isLoaded ? 0 : 1,
            transition: 'opacity 0.6s ease',
          }}
        />
        <div
          ref={mapMountRef}
          className="w-full h-full"
          style={{ width: '100%', height: '100%' }}
        />
      </div>

      <div className="lg-float" style={{ right: '40px', top: '150px', width: '210px' }}>
        <span className="m-ico">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            width="17"
            height="17"
          >
            <path d="M4 4h16v16H4z" />
            <path d="M4 10h16M4 15h16M10 4v16M15 4v16" />
          </svg>
        </span>
        <b>{displayCounty}</b>
        <span className="note">Census tracts analyzed</span>
        <div className="v num">{displayTracts}</div>
      </div>

      <div className="lg-float" style={{ left: '40px', bottom: '96px', width: '230px' }}>
        <b>Community vulnerability</b>
        <div
          className="legend"
          style={{ padding: '8px 0 0', minWidth: 0, background: 'none', border: 0, boxShadow: 'none' }}
          id="lg-leg"
        >
          <div className="ttl">
            <span>Vulnerability index</span>
          </div>
          <div className="ramp">
            {SVI_RAMP_COLORS.map((col, idx) => (
              <i key={idx} style={{ background: col }} />
            ))}
          </div>
          <div className="ends">
            <span>0.01</span>
            <span>Counties</span>
            <span>0.99</span>
          </div>
        </div>
      </div>

      <div className="lg-caps">
        <span>Health map</span>
        <span>Tract explorer</span>
        <span>Disparities</span>
        <span>Needs assessments</span>
        <span>Reports</span>
      </div>
    </section>
  );
}

export default LoginShowcaseMap;
