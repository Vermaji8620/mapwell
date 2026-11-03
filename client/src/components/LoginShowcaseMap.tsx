'use client';

import React from 'react';

// Static map extracted from the supplied Inspect Element HTML.
// The map geometry, county fills, borders, and hotspot markers are preserved in public/mapwell-login-map.svg.
export interface LoginShowcaseMapProps {
  countyName?: string;
  tractCount?: number;
  className?: string;
}

export function LoginShowcaseMap({
  countyName = 'King County, WA',
  tractCount = 498,
  className = '',
}: LoginShowcaseMapProps) {
  return (
    <section className={`lg-side ${className}`} aria-hidden="true">
      <div className="lg-copy">
        <h2>Census tract insight for every community you serve</h2>
        <p>
          Map social determinants, disease incidence and program use, find underserved
          neighborhoods, and turn findings into assessments.
        </p>
      </div>

      {/* Exact static SVG map from the supplied inspected HTML. */}
      <div id="lg-map" className="map-shell">
        <img
          className="map-svg w-full h-full block select-none pointer-events-none"
          src="/mapwell-login-map.svg"
          alt="County-level map of the United States with community vulnerability shading and hotspot markers"
          draggable={false}
        />
      </div>

      <div className="lg-float" style={{ right: '40px', top: '150px', width: '210px' }}>
        <span className="m-ico">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
            <rect x="3" y="3" width="7" height="7" />
            <rect x="14" y="3" width="7" height="7" />
            <rect x="14" y="14" width="7" height="7" />
            <rect x="3" y="14" width="7" height="7" />
          </svg>
        </span>
        <b>{countyName}</b>
        <span className="note">Census tracts analyzed</span>
        <div className="v num">{tractCount}</div>
      </div>

      <div className="lg-float" style={{ left: '40px', bottom: '96px', width: '230px' }}>
        <b>Community vulnerability</b>
        <div className="legend" style={{ padding: '8px 0 0', minWidth: 0, background: 'none', border: 0, boxShadow: 'none' }}>
          <div className="ramp">
            {['#CDE7FB', '#8CC6F4', '#4C9BEA', '#2462C9', '#163A7E'].map((color, idx) => (
              <i key={idx} style={{ background: color }} />
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
