'use client';

import React, { useState, useMemo, useEffect, useRef, Suspense } from 'react';
import { useSession } from '@/context/SessionContext';
import { METRICS_CONFIG } from '@/config/metrics';
import {
  Download,
  Play,
  Pause,
  Sparkles,
  Search,
  ExternalLink,
  ChevronRight,
  TrendingUp,
  Activity
} from 'lucide-react';
import Link from 'next/link';
import { Icon } from '@/components/Icons';
import { TemporalDiseaseMap, createDiseaseColorScale } from '@/components/TemporalDiseaseMap';
import { TrendLineChart, TrendSeries } from '@/components/TrendLineChart';
import { BarChart, BarDatum } from '@/components/BarChart';
import { Sparkline } from '@/components/Sparkline';
import {
  CountyRecord,
  getCountyRepository,
  STATE_META
} from '@/utils/countyRepository';

const CONDS = ['diabetes', 'hypertension', 'asthma', 'obesity', 'copd'];
const YEARS = ['2016', '2017', '2018', '2019', '2020', '2021', '2022', '2023', '2024', '2025'];
const REGIONS = ['Northeast', 'Midwest', 'South', 'West'];

function hashStr(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1e6) / 1e6;
}

function rngGen(seed: number): () => number {
  let s = Math.floor(seed * 2147483646) + 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

function gaussRand(r: () => number): number {
  return Math.sqrt(-2 * Math.log(r() + 1e-9)) * Math.cos(2 * Math.PI * r());
}

function trendFor(seed: string, end: number, n = 10, slope = 0.022): number[] {
  const r = rngGen(hashStr(seed));
  const out: number[] = [];
  let v = end * (1 + slope * n * (r() > 0.3 ? 1 : -0.5));
  for (let i = 0; i < n; i++) {
    v = v + (end - v) / (n - i) + gaussRand(r) * end * 0.012;
    out.push(v);
  }
  out[n - 1] = end;
  return out;
}

function DiseaseIncidenceContent() {
  const { activeCounty, markWorkflowMilestone } = useSession();

  const [repo, setRepo] = useState<{
    counties: CountyRecord[];
    countyById: Map<string, CountyRecord>;
    countiesByState: Map<string, CountyRecord[]>;
  } | null>(null);

  const [condition, setCondition] = useState<string>('diabetes');
  const [scopeSt, setScopeSt] = useState<string | null>(null); // null = USA, or stateFips
  const [yearIndex, setYearIndex] = useState<number>(9); // 9 = 2025
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [selectedCountyId, setSelectedCountyId] = useState<string | null>(
    activeCounty?._id || '27053'
  );
  const [filterQuery, setFilterQuery] = useState<string>('');

  const playTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Load county repository
  useEffect(() => {
    getCountyRepository().then(res => {
      setRepo(res);
    });
  }, []);

  useEffect(() => {
    markWorkflowMilestone('layer');
  }, [markWorkflowMilestone]);

  // Synchronize active county
  useEffect(() => {
    if (activeCounty?._id) {
      setSelectedCountyId(activeCounty._id);
    }
  }, [activeCounty]);

  // Pre-generate 10-year trends for all counties for the active condition
  const countyTrends = useMemo(() => {
    const trends = new Map<string, number[]>();
    if (!repo) return trends;

    repo.counties.forEach(c => {
      const endVal = (c.indicators as any)[condition] ?? 10;
      const t = trendFor(c.id + condition, endVal, 10, 0.022);
      trends.set(c.id, t);
    });
    return trends;
  }, [repo, condition]);

  // Play / Pause timer effect
  useEffect(() => {
    if (isPlaying) {
      playTimerRef.current = setInterval(() => {
        setYearIndex(prev => {
          if (prev >= 9) {
            setIsPlaying(false);
            return 9;
          }
          return prev + 1;
        });
      }, 1000);
    } else if (playTimerRef.current) {
      clearInterval(playTimerRef.current);
      playTimerRef.current = null;
    }

    return () => {
      if (playTimerRef.current) clearInterval(playTimerRef.current);
    };
  }, [isPlaying]);

  const togglePlay = () => {
    if (isPlaying) {
      setIsPlaying(false);
    } else {
      if (yearIndex >= 9) {
        setYearIndex(0);
      }
      setIsPlaying(true);
    }
  };

  const metricMeta = useMemo(() => {
    return METRICS_CONFIG[condition] || { label: condition, short: condition, unit: '%' };
  }, [condition]);

  // Current scope state object
  const currentStateMeta = useMemo(() => {
    const fips = scopeSt || activeCounty?.stateFips || '27';
    const m = STATE_META[fips] || ['MN', 'Minnesota', 'Midwest'];
    return { fips, abbr: m[0], name: m[1], region: m[2] };
  }, [scopeSt, activeCounty]);

  // Counties pool in view (National or State)
  const poolCounties = useMemo(() => {
    if (!repo) return [];
    if (scopeSt) {
      return repo.countiesByState.get(scopeSt) || [];
    }
    return repo.counties;
  }, [repo, scopeSt]);

  // Disease Color Scale & Legend Bins across all 10 years (Fixed across years matching prototype)
  const diseaseScaleInfo = useMemo(() => {
    const allVals: number[] = [];
    poolCounties.forEach(c => {
      const t = countyTrends.get(c.id);
      if (t) allVals.push(...t);
      else allVals.push((c.indicators as any)[condition] ?? 10);
    });
    if (allVals.length === 0) allVals.push(5, 25);
    return createDiseaseColorScale(allVals);
  }, [poolCounties, countyTrends, condition]);

  // Active Focus County
  const focusCounty = useMemo(() => {
    if (!repo || !selectedCountyId) return null;
    return repo.countyById.get(selectedCountyId) || repo.counties[0] || null;
  }, [repo, selectedCountyId]);

  // Focus County Rate for current year
  const focusCountyRate = useMemo(() => {
    if (!focusCounty) return 0;
    const trend = countyTrends.get(focusCounty.id);
    return trend ? trend[yearIndex] : (focusCounty.indicators as any)[condition] ?? 0;
  }, [focusCounty, countyTrends, yearIndex, condition]);

  // Focus County Percentile rank in state
  const focusPercentile = useMemo(() => {
    if (!focusCounty || !repo) return null;
    const stateList = repo.countiesByState.get(focusCounty.st) || [];
    if (stateList.length === 0) return null;

    const values = stateList.map(c => {
      const t = countyTrends.get(c.id);
      return t ? t[yearIndex] : (c.indicators as any)[condition] ?? 0;
    }).sort((a, b) => a - b);

    const rankIdx = values.findIndex(v => v >= focusCountyRate);
    const pct = Math.round(((rankIdx === -1 ? values.length : rankIdx) / values.length) * 100);
    return Math.max(1, Math.min(99, pct));
  }, [focusCounty, repo, countyTrends, yearIndex, condition, focusCountyRate]);

  // Geographic Distribution by Region (BarChart)
  const regionalDistributionData: BarDatum[] = useMemo(() => {
    if (!repo) return [];
    return REGIONS.map(reg => {
      const regCounties = repo.counties.filter(c => c.region === reg);
      const totalPop = regCounties.reduce((acc, c) => acc + c.pop, 0) || 1;
      const weightedSum = regCounties.reduce((acc, c) => {
        const trend = countyTrends.get(c.id);
        const val = trend ? trend[yearIndex] : (c.indicators as any)[condition] ?? 0;
        return acc + val * c.pop;
      }, 0);
      return {
        label: reg,
        value: weightedSum / totalPop,
        color: 'var(--cyan)'
      };
    });
  }, [repo, countyTrends, yearIndex, condition]);

  // 10-Year Time-Based Trend Series: County vs State vs National Median
  const timeBasedTrendSeries: TrendSeries[] = useMemo(() => {
    if (!repo) return [];

    // Focus County Series
    const countyValues = focusCounty ? countyTrends.get(focusCounty.id) || [] : [];

    // State Series
    const stateList = focusCounty ? repo.countiesByState.get(focusCounty.st) || [] : [];
    const stateTotalPop = stateList.reduce((acc, c) => acc + c.pop, 0) || 1;
    const stateValues = YEARS.map((_, idx) => {
      const sum = stateList.reduce((acc, c) => {
        const t = countyTrends.get(c.id);
        return acc + (t ? t[idx] : 10) * c.pop;
      }, 0);
      return sum / stateTotalPop;
    });

    // National Median Series
    const natValues = YEARS.map((_, idx) => {
      const vals = repo.counties.map(c => {
        const t = countyTrends.get(c.id);
        return t ? t[idx] : 10;
      }).sort((a, b) => a - b);
      return vals[Math.floor(vals.length / 2)] || 10;
    });

    return [
      {
        name: focusCounty ? `${focusCounty.name} County` : 'County',
        color: '#37C8CF',
        values: countyValues
      },
      {
        name: `${focusCounty?.stateName || 'State'} Average`,
        color: '#8B5CF6',
        values: stateValues
      },
      {
        name: 'National Median',
        color: 'rgba(255,255,255,0.4)',
        values: natValues,
        dash: '4 4',
        width: 1.8
      }
    ];
  }, [repo, focusCounty, countyTrends]);

  // Influenza-Like Illness (ILI) Weekly Surveillance Curve (52 weeks)
  const iliWeeks = useMemo(() => {
    return Array.from({ length: 52 }, (_, i) => `Wk ${((i + 39) % 52) + 1}`);
  }, []);

  const iliSeries: TrendSeries[] = useMemo(() => {
    const fips = focusCounty?.id || '27053';
    const rCurrent = rngGen(hashStr(fips + 'ili26'));
    const rPrevious = rngGen(hashStr(fips + 'ili25'));

    const currentSeason = Array.from({ length: 52 }, (_, i) => {
      const base = 1.4 + 4.6 * Math.exp(-((i - 18) ** 2) / 40) + gaussRand(rCurrent) * 0.12;
      return Math.max(0.2, base);
    });

    const previousSeason = Array.from({ length: 52 }, (_, i) => {
      const base = 1.4 + 5.4 * Math.exp(-((i - 18) ** 2) / 40) + gaussRand(rPrevious) * 0.12;
      return Math.max(0.2, base);
    });

    return [
      {
        name: '2025–26 Season',
        color: '#F59E0B',
        values: currentSeason
      },
      {
        name: '2024–25 Season',
        color: '#8B5CF6',
        values: previousSeason,
        dash: '4 4',
        width: 1.6
      }
    ];
  }, [focusCounty]);

  // Filtered & Ranked County Table
  const tableRows = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    const rows = poolCounties.filter(c => !q || c.name.toLowerCase().includes(q) || c.id.includes(q));

    return rows.map(c => {
      const trend = countyTrends.get(c.id) || [10, 10, 10, 10, 10, 10, 10, 10, 10, 10];
      const currentVal = trend[yearIndex];
      const startVal = trend[0];
      const endVal = trend[9];
      const changePts = endVal - startVal;

      // Margin of error (95% CI)
      const moe = 1.96 * Math.sqrt((endVal * (100 - endVal)) / Math.max(400, c.pop * 0.02));

      return {
        county: c,
        currentVal,
        ciLow: Math.max(0, endVal - moe),
        ciHigh: endVal + moe,
        changePts,
        trend
      };
    }).sort((a, b) => b.currentVal - a.currentVal).slice(0, 60);
  }, [poolCounties, filterQuery, countyTrends, yearIndex]);

  // Automated Epidemiologic Insights
  const insights = useMemo(() => {
    if (poolCounties.length === 0) return [];
    let risingCount = 0;
    let worstCounty: CountyRecord | null = null;
    let worstVal = -Infinity;

    poolCounties.forEach(c => {
      const t = countyTrends.get(c.id);
      if (t) {
        if (t[9] - t[0] > 0) risingCount++;
        if (t[yearIndex] > worstVal) {
          worstVal = t[yearIndex];
          worstCounty = c;
        }
      }
    });

    // Correlation with SVI
    const xs = poolCounties.map(c => c.svi);
    const ys = poolCounties.map(c => {
      const t = countyTrends.get(c.id);
      return t ? t[yearIndex] : 10;
    });

    const meanX = xs.reduce((a, b) => a + b, 0) / xs.length;
    const meanY = ys.reduce((a, b) => a + b, 0) / ys.length;

    let num = 0, denX = 0, denY = 0;
    for (let i = 0; i < xs.length; i++) {
      const dx = xs[i] - meanX;
      const dy = ys[i] - meanY;
      num += dx * dy;
      denX += dx * dx;
      denY += dy * dy;
    }
    const corr = denX && denY ? num / Math.sqrt(denX * denY) : 0.65;

    return [
      {
        title: `${risingCount} of ${poolCounties.length} counties show rising prevalence`,
        detail: `Higher rate in 2025 compared to 2016 baseline across the surveillance window.`
      },
      {
        title: `${worstCounty ? (worstCounty as CountyRecord).name : 'Top'} County leads with ${worstVal.toFixed(1)}%`,
        detail: `Highest burden area in current view for ${metricMeta.label} in ${YEARS[yearIndex]}.`
      },
      {
        title: `Positive correlation with SVI (r = ${corr.toFixed(2)})`,
        detail: `Pearson correlation demonstrates high chronic burden clustering in high-vulnerability tracts.`
      }
    ];
  }, [poolCounties, countyTrends, yearIndex, metricMeta]);

  // CSV Export Handler
  const handleExportTable = () => {
    if (!poolCounties.length) return;
    const headers = ['FIPS', 'County', 'State', ...YEARS.map(y => `${condition}_${y}`), 'Data Status'];
    const rows = poolCounties.map(c => {
      const t = countyTrends.get(c.id) || [];
      return [
        c.id,
        `"${c.name} County"`,
        c.stateAbbr,
        ...YEARS.map((_, i) => (t[i] ? t[i].toFixed(2) : 'N/A')),
        '"CDC/ACS Surveillance Benchmark"'
      ];
    });

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `${condition}-prevalence-by-county.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const cond = condition;
  const setCond = setCondition;
  const activeYear = YEARS[yearIndex];
  const activeMeta = metricMeta;
  const activeCountyRate = focusCountyRate;
  const regionalBars = regionalDistributionData;
  const countySearch = filterQuery;
  const setCountySearch = setFilterQuery;

  const nationalMedian = useMemo(() => {
    if (!repo) return 10;
    const vals = repo.counties.map(c => {
      const t = countyTrends.get(c.id);
      return t ? t[yearIndex] : (c.indicators as any)[condition] ?? 0;
    }).sort((a, b) => a - b);
    return vals[Math.floor(vals.length / 2)] || 10;
  }, [repo, countyTrends, yearIndex, condition]);

  const deltaFromNat = focusCountyRate - nationalMedian;

  const tableCounties = useMemo(() => {
    return poolCounties
      .map(c => {
        const trend = countyTrends.get(c.id);
        const valCurrent = trend ? trend[yearIndex] : 10;
        const val2016 = trend ? trend[0] : 10;
        const diff = valCurrent - val2016;
        return {
          id: c.id,
          name: c.name,
          stateAbbr: c.st,
          valCurrent,
          val2016,
          diff,
          spark: trend || [10, 10]
        };
      })
      .filter(c => !filterQuery || c.name.toLowerCase().includes(filterQuery.toLowerCase()))
      .sort((a, b) => b.valCurrent - a.valCurrent);
  }, [poolCounties, countyTrends, yearIndex, filterQuery]);

  const highestRegion = useMemo(() => {
    if (regionalDistributionData.length === 0) return { region: 'South', rate: 12.4 };
    const sorted = [...regionalDistributionData].sort((a, b) => b.value - a.value);
    return { region: sorted[0].label, rate: sorted[0].value };
  }, [regionalDistributionData]);

  return (
    <>
      {/* Page Header */}
      <div className="page-head">
        <div>
          <h1>Disease incidence</h1>
          <p>Track chronic condition prevalence across counties and over time. Use the timeline to observe geographic progression.</p>
        </div>
        <div className="head-actions">
          <span className="pill demo">
            <span className="dot"></span>Demo environment
          </span>
          <button className="btn" id="di-exp" onClick={handleExportTable}>
            <Icon name="download" size={14} />
            <span>Export table</span>
          </button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="toolbar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap', marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'wrap' }}>
          <div className="field" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--muted)' }}>Condition</span>
            <div className="chips" id="di-cond">
              {CONDS.map((c) => (
                <button
                  key={c}
                  className={`chip ${cond === c ? 'on' : ''}`}
                  onClick={() => setCond(c)}
                >
                  {METRICS_CONFIG[c]?.short || c}
                </button>
              ))}
            </div>
          </div>

          <div className="field" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--muted)' }}>Geography</span>
            <div className="seg" id="di-g">
              <button
                className={!scopeSt ? 'on' : ''}
                onClick={() => setScopeSt(null)}
              >
                United States
              </button>
              <button
                className={scopeSt ? 'on' : ''}
                onClick={() => setScopeSt(activeCounty?.stateFips || '53')}
              >
                {activeCounty?.stateAbbr || activeCounty?.stateName || 'State'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid g-12" style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: '16px' }}>
        {/* Panel 1: Map with Timeline Slider (c-8) */}
        <section className="panel c-8" style={{ gridColumn: 'span 8', padding: 0, overflow: 'hidden', minHeight: '460px', position: 'relative' }}>
          <div style={{ position: 'absolute', inset: '0 0 70px 0' }} id="di-map">
            <TemporalDiseaseMap
              scopeSt={scopeSt}
              condition={condition}
              yearIndex={yearIndex}
              years={YEARS}
              selectedCountyId={selectedCountyId}
              onSelectCounty={(c) => setSelectedCountyId(c.id)}
              countyTrends={countyTrends}
              height={390}
            />
          </div>

          {/* Legend Float */}
          <div className="map-float legend" style={{ position: 'absolute', left: '14px', top: '14px', zIndex: 10 }} id="di-leg">
            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--muted)', marginBottom: '4px' }}>
              {activeMeta.label}, {activeYear}
            </div>
            <div style={{ display: 'flex', height: '8px', borderRadius: '4px', overflow: 'hidden', width: '160px' }}>
              {['#BDEFF0', '#37C8CF', '#2A9FD6', '#2565C8', '#173F8A'].map((c, i) => (
                <div key={i} style={{ flex: 1, height: '100%', backgroundColor: c }} />
              ))}
            </div>
            <div className="ends" style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--faint)', marginTop: '2px' }}>
              <span>Lower rate</span>
              <span>Higher burden</span>
            </div>
          </div>

          {/* Bottom Timeline Controls */}
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              height: '70px',
              borderTop: '1px solid var(--line)',
              display: 'flex',
              alignItems: 'center',
              gap: '16px',
              padding: '0 20px',
              background: 'var(--surface-solid)',
              zIndex: 10
            }}
          >
            <button
              className="icon-btn"
              id="di-play"
              aria-label={isPlaying ? 'Pause timeline' : 'Play timeline'}
              onClick={togglePlay}
              style={{ width: '38px', height: '38px', borderRadius: '12px' }}
            >
              <Icon name={isPlaying ? 'pause' : 'play'} size={16} />
            </button>

            <div style={{ flex: 1 }}>
              <input
                type="range"
                className="range"
                min="0"
                max="9"
                value={yearIndex}
                onChange={(e) => setYearIndex(Number(e.target.value))}
                style={{ width: '100%', accentColor: 'var(--cyan)' }}
                aria-label="Year slider"
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--faint)', marginTop: '4px' }}>
                {YEARS.map((y, i) => (
                  <span key={y} style={{ fontWeight: i === yearIndex ? 700 : 400, color: i === yearIndex ? 'var(--cyan)' : undefined }}>
                    {y}
                  </span>
                ))}
              </div>
            </div>

            <div className="num" style={{ fontSize: '26px', fontWeight: 700, minWidth: '64px', textAlign: 'right', color: 'var(--cyan)' }} id="di-ylab">
              {activeYear}
            </div>
          </div>
        </section>

        {/* Right Stack: KPI & Regional Distribution (c-4) */}
        <div className="c-4 stack" style={{ gridColumn: 'span 4', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* KPI Card */}
          <section className="panel tight" style={{ padding: '18px' }}>
            <div className="kpi">
              <span className="k-label" style={{ fontSize: '12px', fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: '4px' }}>
                {activeCounty?.name || 'King County'}, {activeCounty?.stateAbbr || 'WA'}
              </span>
              <span className="k-val num" id="di-jv" style={{ fontSize: '32px', fontWeight: 700, color: 'var(--cyan)' }}>
                {activeCountyRate.toFixed(1)}%
              </span>
              <div className="k-foot" id="di-jf" style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '4px' }}>
                {activeMeta.label} in {activeYear}.{' '}
                <span className="num" style={{ fontWeight: 600, color: 'var(--text)' }}>
                  {deltaFromNat >= 0 ? `+${deltaFromNat.toFixed(1)}%` : `${deltaFromNat.toFixed(1)}%`}
                </span>{' '}
                relative to national median ({nationalMedian.toFixed(1)}%)
              </div>
            </div>
          </section>

          {/* Regional distribution */}
          <section className="panel" style={{ padding: '18px', flex: 1 }}>
            <div className="panel-h" style={{ marginBottom: '10px' }}>
              <div>
                <h3>Geographic distribution</h3>
                <div className="sub">Population-weighted rate by US Census region</div>
              </div>
            </div>
            <div style={{ height: '170px' }}>
              <BarChart
                data={regionalBars}
                height={170}
                unit="%"
              />
            </div>
          </section>
        </div>

        {/* Panel 3: Time-based Trends (c-7) */}
        <section className="panel c-7" style={{ gridColumn: 'span 7' }}>
          <div className="panel-h">
            <div>
              <h3>Time-based trends</h3>
              <div className="sub">Prevalence, 2016 – 2025: {activeCounty?.name}, {activeCounty?.stateAbbr} and national median</div>
            </div>
          </div>
          <div style={{ height: '240px', marginTop: '10px' }}>
            <TrendLineChart
              years={YEARS}
              series={timeBasedTrendSeries}
              height={240}
              unit="%"
            />
          </div>
        </section>

        {/* Panel 4: Seasonal Illness Curve (c-5) */}
        <section className="panel c-5" style={{ gridColumn: 'span 5' }}>
          <div className="panel-h">
            <div>
              <h3>Influenza-like illness</h3>
              <div className="sub">Weekly share of outpatient visits, current vs prior season</div>
            </div>
          </div>
          <div style={{ height: '240px', marginTop: '10px' }}>
            <TrendLineChart
              years={['Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May']}
              series={[
                { name: '2024–2025 (Current)', color: 'var(--rose)', values: [1.8, 2.4, 4.2, 5.8, 4.9, 3.1, 2.0, 1.5] },
                { name: '2023–2024 (Prior)', color: 'var(--teal)', values: [1.5, 2.1, 3.6, 4.8, 3.9, 2.6, 1.8, 1.2], dash: '4 4' }
              ]}
              height={240}
              unit="%"
            />
          </div>
        </section>

        {/* Panel 5: County Data Table (c-8) */}
        <section className="panel c-8" style={{ gridColumn: 'span 8' }}>
          <div className="panel-h">
            <div>
              <h3>County data table</h3>
              <div className="sub" id="di-tsub">
                {activeMeta.label}, {tableCounties.length} counties, highest prevalence first
              </div>
            </div>
            <div className="search" style={{ width: '220px' }}>
              <Icon name="search" size={13} />
              <input
                id="di-q"
                placeholder="Filter counties…"
                value={countySearch}
                onChange={(e) => setCountySearch(e.target.value)}
              />
            </div>
          </div>

          <div className="tbl-wrap" style={{ maxHeight: '280px', overflowY: 'auto' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>County</th>
                  <th className="r">{activeYear}</th>
                  <th className="r">2016</th>
                  <th className="r">10-yr change</th>
                  <th className="r">Trend</th>
                </tr>
              </thead>
              <tbody>
                {tableCounties.map((c) => (
                  <tr key={c.id}>
                    <td><b>{c.name} County, {c.stateAbbr}</b></td>
                    <td className="r num" style={{ fontWeight: 700, color: 'var(--cyan)' }}>{c.valCurrent.toFixed(1)}%</td>
                    <td className="r num">{c.val2016.toFixed(1)}%</td>
                    <td className="r num" style={{ color: c.diff >= 0 ? 'var(--rose)' : 'var(--teal)', fontWeight: 600 }}>
                      {c.diff >= 0 ? `+${c.diff.toFixed(1)}%` : `${c.diff.toFixed(1)}%`}
                    </td>
                    <td className="r">
                      <div style={{ width: '80px', height: '22px', marginLeft: 'auto' }}>
                        <Sparkline values={c.spark} color={c.diff >= 0 ? 'var(--rose)' : 'var(--teal)'} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Panel 6: Geographic Insights (c-4) */}
        <section className="panel c-4" style={{ gridColumn: 'span 4' }}>
          <div className="panel-h">
            <h3>Geographic insights</h3>
          </div>
          <div className="stack" id="di-ins" style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '10px' }}>
            <div className="insight">
              <span className="ic"><Icon name="spark" size={16} /></span>
              <p>
                The national median for {activeMeta.short} has risen from{' '}
                <b>{(nationalMedian - 1.2).toFixed(1)}% to {nationalMedian.toFixed(1)}%</b> between 2016 and {activeYear}.
                <small>Long-term upward trajectory requiring proactive preventive health strategies.</small>
              </p>
            </div>

            <div className="insight">
              <span className="ic"><Icon name="spark" size={16} /></span>
              <p>
                The {highestRegion.region} region records the highest regional burden, at{' '}
                <b>{highestRegion.rate.toFixed(1)}%</b>.
                <small>Concentration of rural poverty exacerbates clinical care shortages.</small>
              </p>
            </div>

            <div className="insight">
              <span className="ic"><Icon name="spark" size={16} /></span>
              <p>
                {activeCounty?.name || 'Local'} jurisdiction rate is{' '}
                <b>{Math.abs(deltaFromNat).toFixed(1)} percentage points {deltaFromNat >= 0 ? 'above' : 'below'}</b>{' '}
                the national median in {activeYear}.
                <small>Prioritize mobile screenings in high-SVI tracts.</small>
              </p>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}

export default function DiseaseIncidencePage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-[13px] text-[var(--muted)]">Loading disease incidence surveillance...</div>}>
      <DiseaseIncidenceContent />
    </Suspense>
  );
}
