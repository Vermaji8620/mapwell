'use client';

import React, { useEffect, useState } from 'react';
import { useSession } from '@/context/SessionContext';
import { CensusTract, Jurisdiction } from '@/types';
import { TIER_LABELS, TIER_COLORS, METRICS_CONFIG, MAP_LAYERS } from '@/config/metrics';
import {
  Layers,
  Flag,
  Share2,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Sliders,
  Check,
  ChevronRight,
  Flame,
  Crosshair,
  Search,
  MapPin,
  Maximize2
} from 'lucide-react';
import Link from 'next/link';

import { MapViewCanvas } from '@/components/MapViewCanvas';

export default function HealthMapPage() {
  const {
    activeCounty,
    jurisdictions,
    setActiveJurisdiction,
    session,
    toggleFlagTract,
    toggleCompareTract,
    markWorkflowMilestone
  } = useSession();

  const [activeLayer, setActiveLayer] = useState<string>('sdoh');
  const [activeMetric, setActiveMetric] = useState<string>('svi');
  const [tracts, setTracts] = useState<CensusTract[]>([]);
  const [selectedTract, setSelectedTract] = useState<CensusTract | null>(null);
  const [heatmapEnabled, setHeatmapEnabled] = useState(true);
  const [markersEnabled, setMarkersEnabled] = useState(true);
  const [countySearch, setCountySearch] = useState('');
  const [countySearchOpen, setCountySearchOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    markWorkflowMilestone('map');
  }, [markWorkflowMilestone]);

  // Load tracts for active county from MongoDB
  useEffect(() => {
    if (!activeCounty) return;
    setLoading(true);
    fetch(`/api/tracts?county=${activeCounty._id}`)
      .then(r => r.ok ? r.json() : { data: [] })
      .then(res => {
        const data = res.data || [];
        setTracts(data);
        if (data.length > 0) {
          setSelectedTract(data[0]);
        }
      })
      .catch(e => console.error(e))
      .finally(() => setLoading(false));
  }, [activeCounty]);

  const currentLayer = MAP_LAYERS.find(l => l.id === activeLayer) || MAP_LAYERS[0];

  const searchResults = jurisdictions.filter(j =>
    `${j.name} ${j.stateName} ${j.stateAbbr}`.toLowerCase().includes(countySearch.toLowerCase())
  );

  const highestNeedTracts = [...tracts]
    .sort((a, b) => b.svi - a.svi)
    .slice(0, 6);

  return (
    <div className="relative h-[calc(100vh-115px)] w-full rounded-2xl overflow-hidden glass-panel flex flex-col lg:flex-row animate-in fade-in">
      {/* Floating Left Layer & Indicator Panel */}
      <div className="w-full lg:w-80 h-auto lg:h-full border-r border-[var(--line)] bg-[var(--surface-solid)]/85 backdrop-blur-xl p-4 overflow-y-auto z-10 flex flex-col justify-between flex-shrink-0">
        <div className="space-y-4">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--faint)]">Geospatial Overlay</span>
            <h2 className="text-base font-bold text-[var(--text)]">Layers & Indicators</h2>
          </div>

          {/* County Search Input */}
          <div className="relative">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-[var(--line)] bg-[var(--surface-2)]">
              <Search className="w-3.5 h-3.5 text-[var(--faint)] flex-shrink-0" />
              <input
                type="text"
                placeholder="Search a county to inspect..."
                value={countySearch}
                onChange={(e) => {
                  setCountySearch(e.target.value);
                  setCountySearchOpen(e.target.value.trim().length > 1);
                }}
                className="w-full bg-transparent text-[12px] text-[var(--text)] outline-none"
              />
            </div>
            {countySearchOpen && (
              <div className="absolute top-10 left-0 right-0 max-h-48 overflow-y-auto rounded-xl bg-[var(--surface-solid)] border border-[var(--line-strong)] shadow-xl p-1 z-30">
                {searchResults.length > 0 ? (
                  searchResults.map(j => (
                    <button
                      key={j._id}
                      onClick={() => {
                        setActiveJurisdiction(j._id);
                        setCountySearch('');
                        setCountySearchOpen(false);
                      }}
                      className="w-full flex items-center justify-between p-2 rounded-lg text-left text-[12px] hover:bg-[var(--surface-2)] text-[var(--text)]"
                    >
                      <span className="font-semibold">{j.name}, {j.stateAbbr}</span>
                      <span className="text-[10px] text-[var(--faint)]">{(j.population / 1000).toFixed(0)}k pop</span>
                    </button>
                  ))
                ) : (
                  <div className="p-2 text-[11px] text-[var(--muted)]">No county matches found</div>
                )}
              </div>
            )}
          </div>

          {/* Map Layers */}
          <div>
            <span className="text-[11px] font-bold text-[var(--faint)] uppercase block mb-1.5">Map Layers</span>
            <div className="space-y-1.5">
              {MAP_LAYERS.map((layer) => (
                <button
                  key={layer.id}
                  onClick={() => {
                    setActiveLayer(layer.id);
                    setActiveMetric(layer.metrics[0]);
                    markWorkflowMilestone('layer');
                  }}
                  className={`w-full flex items-center gap-2.5 p-2 rounded-xl text-left transition-all ${
                    activeLayer === layer.id
                      ? 'bg-[var(--glow)] border border-[var(--cyan)] text-[var(--text)]'
                      : 'hover:bg-[var(--surface-2)] text-[var(--muted)] border border-transparent'
                  }`}
                >
                  <span
                    className="w-4 h-4 rounded-md flex-shrink-0"
                    style={{ background: `linear-gradient(135deg, ${layer.ramp.join(',')})` }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-[12.5px] font-bold text-[var(--text)] truncate">{layer.name}</div>
                    <div className="text-[10.5px] text-[var(--muted)] truncate">{layer.desc}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Indicator Pills */}
          <div>
            <span className="text-[11px] font-bold text-[var(--faint)] uppercase block mb-1.5">Active Indicator</span>
            <div className="flex flex-wrap gap-1.5">
              {currentLayer.metrics.map((m) => (
                <button
                  key={m}
                  onClick={() => setActiveMetric(m)}
                  className={`px-2.5 py-1 rounded-lg text-[11.5px] font-bold transition-all ${
                    activeMetric === m
                      ? 'bg-[var(--cyan)] text-white shadow-xs'
                      : 'bg-[var(--surface-2)] text-[var(--muted)] hover:text-[var(--text)] border border-[var(--line)]'
                  }`}
                >
                  {METRICS_CONFIG[m]?.short || m}
                </button>
              ))}
            </div>
          </div>

          {/* Hotspot & Markers Toggles */}
          <div className="pt-3 border-t border-[var(--line)] space-y-2.5">
            <div className="flex items-center justify-between text-[12px]">
              <span className="flex items-center gap-1.5 text-[var(--text)] font-medium">
                <Flame className="w-3.5 h-3.5 text-[var(--rose)]" />
                <span>Hotspot Heatmap</span>
              </span>
              <button
                onClick={() => setHeatmapEnabled(!heatmapEnabled)}
                className={`w-9 h-5 rounded-full transition-colors relative ${heatmapEnabled ? 'bg-[var(--cyan)]' : 'bg-[var(--line-strong)]'}`}
              >
                <span className={`block w-3.5 h-3.5 rounded-full bg-white transition-transform ${heatmapEnabled ? 'translate-x-4' : 'translate-x-1'}`} />
              </button>
            </div>

            <div className="flex items-center justify-between text-[12px]">
              <span className="flex items-center gap-1.5 text-[var(--text)] font-medium">
                <Crosshair className="w-3.5 h-3.5 text-[var(--cyan)]" />
                <span>Highest-Need Markers</span>
              </span>
              <button
                onClick={() => setMarkersEnabled(!markersEnabled)}
                className={`w-9 h-5 rounded-full transition-colors relative ${markersEnabled ? 'bg-[var(--cyan)]' : 'bg-[var(--line-strong)]'}`}
              >
                <span className={`block w-3.5 h-3.5 rounded-full bg-white transition-transform ${markersEnabled ? 'translate-x-4' : 'translate-x-1'}`} />
              </button>
            </div>
          </div>
        </div>

        {/* Quantile Scale Legend */}
        <div className="pt-3 border-t border-[var(--line)]">
          <div className="text-[11px] font-bold text-[var(--muted)] mb-1">
            Quantile Ramp: {METRICS_CONFIG[activeMetric]?.short || activeMetric}
          </div>
          <div
            className="h-2.5 w-full rounded-full"
            style={{ background: `linear-gradient(to right, ${currentLayer.ramp.join(',')})` }}
          />
          <div className="flex justify-between text-[10px] text-[var(--faint)] font-bold mt-1">
            <span>Low Risk (Q1)</span>
            <span>High Burden (Q5)</span>
          </div>
        </div>
      </div>

      {/* Center: Full-height Interactive Vector Canvas Area */}
      <div className="flex-1 relative bg-[var(--surface-2)] overflow-hidden flex flex-col justify-between p-4">
        {/* Top Breadcrumb Navigation */}
        <div className="relative z-10 flex items-center gap-2 px-3 py-1.5 rounded-xl glass-panel text-[12px] font-bold text-[var(--muted)] w-fit shadow-xs">
          <Link href="/health-map" className="hover:text-[var(--cyan)]">United States</Link>
          <span>/</span>
          <span className="text-[var(--text)]">{activeCounty?.stateName || 'Washington'}</span>
          <span>/</span>
          <span className="text-[var(--cyan)]">{activeCounty?.name || 'King County'}</span>
          {selectedTract && (
            <>
              <span>/</span>
              <span className="text-[var(--violet)]">{selectedTract.name}</span>
            </>
          )}
        </div>

        {/* Interactive Map Canvas */}
        <div className="my-auto h-[520px] w-full rounded-2xl overflow-hidden relative">
          <MapViewCanvas
            countyFips={activeCounty?._id || '53033'}
            tracts={tracts}
            selectedTractId={selectedTract?._id}
            onSelectTract={(t) => {
              setSelectedTract(t);
              markWorkflowMilestone('tract');
            }}
            layer={activeLayer}
            metric={activeMetric}
            heatmap={heatmapEnabled}
            markers={markersEnabled}
            height={520}
          />
        </div>

        {/* Bottom Floating Map Controls and Ready Status */}
        <div className="relative z-10 flex items-center justify-between text-[11px] text-[var(--faint)]">
          <div className="flex items-center gap-1.5">
            <button className="p-2 rounded-xl glass-panel text-[var(--text)] hover:text-[var(--cyan)] shadow-xs">
              <ZoomIn className="w-4 h-4" />
            </button>
            <button className="p-2 rounded-xl glass-panel text-[var(--text)] hover:text-[var(--cyan)] shadow-xs">
              <ZoomOut className="w-4 h-4" />
            </button>
            <button
              onClick={() => setSelectedTract(tracts[0] || null)}
              className="p-2 rounded-xl glass-panel text-[var(--text)] hover:text-[var(--cyan)] shadow-xs"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>
          <div className="glass-panel px-3 py-1.5 rounded-xl font-bold text-[var(--text)] flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[var(--teal)] animate-pulse" />
            <span>{tracts.length} census tracts loaded directly from database</span>
          </div>
        </div>
      </div>

      {/* Floating Right Side Inspector Panel */}
      <div className="w-full lg:w-80 h-auto lg:h-full border-t lg:border-t-0 lg:border-l border-[var(--line)] bg-[var(--surface-solid)]/90 backdrop-blur-xl p-5 overflow-y-auto z-10 flex flex-col justify-between flex-shrink-0 animate-in slide-in-from-right-4">
        {selectedTract ? (
          <div className="space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--faint)]">
                  GEOID: {selectedTract._id}
                </span>
                <h3 className="text-base font-bold text-[var(--text)]">{selectedTract.name}</h3>
                <span className="text-[12px] text-[var(--muted)]">{activeCounty?.name}, {activeCounty?.stateAbbr}</span>
              </div>
              <span
                className="px-2.5 py-1 rounded-full text-[11px] font-bold text-white shadow-xs"
                style={{ backgroundColor: TIER_COLORS[selectedTract.tier] }}
              >
                {TIER_LABELS[selectedTract.tier]}
              </span>
            </div>

            {/* Key Indicator Readouts */}
            <div className="space-y-2 pt-2 border-t border-[var(--line)] text-[12.5px]">
              <div className="flex justify-between py-1 border-b border-[var(--line)]/50">
                <span className="text-[var(--muted)]">SVI Vulnerability:</span>
                <span className="font-bold text-[var(--text)] num">{selectedTract.svi.toFixed(2)}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-[var(--line)]/50">
                <span className="text-[var(--muted)]">Population:</span>
                <span className="font-bold text-[var(--text)] num">{(selectedTract.population || 0).toLocaleString()}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-[var(--line)]/50">
                <span className="text-[var(--muted)]">Poverty Rate:</span>
                <span className="font-bold text-[var(--rose)] num">{(selectedTract.indicators as any)?.poverty || 14.2}%</span>
              </div>
              <div className="flex justify-between py-1 border-b border-[var(--line)]/50">
                <span className="text-[var(--muted)]">Uninsured Rate:</span>
                <span className="font-bold text-[var(--amber)] num">{(selectedTract.indicators as any)?.uninsured || 8.6}%</span>
              </div>
              <div className="flex justify-between py-1 border-b border-[var(--line)]/50">
                <span className="text-[var(--muted)]">Adult Diabetes:</span>
                <span className="font-bold text-[var(--rose)] num">{(selectedTract.indicators as any)?.diabetes || 11.2}%</span>
              </div>
              <div className="flex justify-between py-1 border-b border-[var(--line)]/50">
                <span className="text-[var(--muted)]">Life Expectancy:</span>
                <span className="font-bold text-[var(--teal)] num">{(selectedTract.indicators as any)?.lifeExp || 79.4} yrs</span>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="pt-4 border-t border-[var(--line)] space-y-2">
              <button
                onClick={() => toggleFlagTract(selectedTract._id)}
                className={`w-full py-2.5 rounded-xl text-[12.5px] font-bold flex items-center justify-center gap-2 border transition-all ${
                  session?.flaggedTracts?.includes(selectedTract._id)
                    ? 'bg-[var(--rose)]/10 border-[var(--rose)] text-[var(--rose)]'
                    : 'bg-[var(--surface-2)] border-[var(--line)] text-[var(--text)] hover:border-[var(--rose)]'
                }`}
              >
                <Flag className="w-4 h-4" />
                <span>{session?.flaggedTracts?.includes(selectedTract._id) ? 'Flagged as Underserved' : 'Flag as Underserved'}</span>
              </button>

              <button
                onClick={() => toggleCompareTract(selectedTract._id)}
                className={`w-full py-2.5 rounded-xl text-[12.5px] font-bold flex items-center justify-center gap-2 border transition-all ${
                  session?.compareTracts?.includes(selectedTract._id)
                    ? 'bg-[var(--cyan)]/10 border-[var(--cyan)] text-[var(--cyan)]'
                    : 'bg-[var(--surface-2)] border-[var(--line)] text-[var(--text)] hover:border-[var(--cyan)]'
                }`}
              >
                <Share2 className="w-4 h-4" />
                <span>{session?.compareTracts?.includes(selectedTract._id) ? 'In Compare Tray' : 'Add to Compare'}</span>
              </button>

              <Link
                href={`/census-tracts?tract=${selectedTract._id}`}
                className="w-full py-2.5 rounded-xl text-[12.5px] font-bold flex items-center justify-center gap-2 bg-[var(--cyan)] text-white hover:opacity-90 shadow-md transition-all"
              >
                <span>Explore Tract Deep-Dive</span>
                <ChevronRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--faint)]">County Overview</span>
              <h3 className="text-base font-bold text-[var(--text)]">{activeCounty?.name}, {activeCounty?.stateAbbr}</h3>
              <p className="text-[12px] text-[var(--muted)]">FIPS {activeCounty?._id} • {tracts.length} census tracts</p>
            </div>

            <div className="pt-2 border-t border-[var(--line)]">
              <h4 className="text-[12px] font-bold text-[var(--text)] mb-2">Tracts with Highest Need</h4>
              <div className="space-y-1.5">
                {highestNeedTracts.map(t => (
                  <button
                    key={t._id}
                    onClick={() => setSelectedTract(t)}
                    className="w-full flex items-center justify-between p-2 rounded-lg bg-[var(--surface-2)] hover:bg-[var(--surface-solid)] text-left text-[12px]"
                  >
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: TIER_COLORS[t.tier] }} />
                      <span className="font-semibold text-[var(--text)]">{t.name}</span>
                    </div>
                    <span className="font-bold text-[var(--rose)] num">{t.svi.toFixed(2)}</span>
                  </button>
                ))}
              </div>
            </div>

            <Link
              href="/census-tracts"
              className="w-full py-2.5 rounded-xl text-[12.5px] font-bold flex items-center justify-center gap-2 bg-[var(--surface-2)] border border-[var(--line)] text-[var(--text)] hover:border-[var(--line-strong)] transition-all"
            >
              <span>Open All Tracts in Explorer</span>
              <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
