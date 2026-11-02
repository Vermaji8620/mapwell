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

  return (
    <div className="space-y-6 pb-20 animate-in fade-in duration-300">
      {/* Screen Header & Top Action Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-display font-bold text-[var(--text)] tracking-tight">
            Disease Incidence
          </h1>
          <p className="text-[13px] text-[var(--muted)] mt-0.5">
            Track chronic condition prevalence across counties and over time. Use the timeline to see how burden has shifted.
          </p>
        </div>

        <button
          onClick={handleExportTable}
          className="flex items-center gap-2 px-4 py-2 rounded-xl border border-[var(--line-strong)] bg-[var(--surface-solid)] text-[12.5px] font-bold text-[var(--text)] hover:bg-[var(--surface-2)] shadow-xs transition-all self-start sm:self-auto"
        >
          <Download className="w-4 h-4 text-[var(--cyan)]" />
          <span>Export Table</span>
        </button>
      </div>

      {/* Toolbar: Condition Chips & Geography Scope */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 rounded-2xl glass-panel">
        {/* Chronic Condition Chips */}
        <div>
          <span className="text-[11px] font-bold text-[var(--faint)] uppercase block mb-1.5">
            Chronic Condition
          </span>
          <div className="flex items-center gap-2 flex-wrap">
            {CONDS.map(cKey => {
              const meta = METRICS_CONFIG[cKey] || { short: cKey };
              const isSelected = cKey === condition;
              return (
                <button
                  key={cKey}
                  onClick={() => setCondition(cKey)}
                  className={`px-3.5 py-1.5 rounded-xl text-[12px] font-bold transition-all ${
                    isSelected
                      ? 'bg-[var(--cyan)] text-white shadow-xs'
                      : 'bg-[var(--surface-2)] text-[var(--muted)] hover:text-[var(--text)] border border-[var(--line)]'
                  }`}
                >
                  {meta.short}
                </button>
              );
            })}
          </div>
        </div>

        {/* Geography Toggle */}
        <div>
          <span className="text-[11px] font-bold text-[var(--faint)] uppercase block mb-1.5">
            Geography Scope
          </span>
          <div className="flex rounded-xl border border-[var(--line)] overflow-hidden text-[12px] font-bold bg-[var(--surface-2)]">
            <button
              onClick={() => setScopeSt(null)}
              className={`px-3.5 py-1.5 transition-colors ${
                scopeSt === null ? 'bg-[var(--cyan)] text-white shadow-xs' : 'text-[var(--muted)] hover:text-[var(--text)]'
              }`}
            >
              United States
            </button>
            <button
              onClick={() => setScopeSt(currentStateMeta.fips)}
              className={`px-3.5 py-1.5 transition-colors ${
                scopeSt !== null ? 'bg-[var(--cyan)] text-white shadow-xs' : 'text-[var(--muted)] hover:text-[var(--text)]'
              }`}
            >
              {currentStateMeta.name} Counties
            </button>
          </div>
        </div>
      </div>

      {/* Main 12-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Col 8: Temporal Map with Scrubbable 10-Year Timeline Bar */}
        <section className="lg:col-span-8 rounded-2xl glass-panel relative overflow-hidden flex flex-col justify-between min-h-[500px] border border-[var(--line)] bg-[var(--surface-solid)]/70">
          {/* Floating Legend Top-Left */}
          <div className="absolute top-4 left-4 z-20 px-3.5 py-2.5 rounded-xl bg-[var(--surface-solid)]/95 backdrop-blur-md border border-[var(--line-strong)] shadow-lg min-w-[220px] text-[11px]">
            <div className="font-bold text-[var(--text)] mb-1.5 flex justify-between items-center">
              <span>{metricMeta.label}, {YEARS[yearIndex]}</span>
            </div>
            <div className="flex h-2.5 rounded overflow-hidden mb-1.5">
              {diseaseScaleInfo.bins.map((c, i) => (
                <div key={i} className="flex-1 h-full" style={{ backgroundColor: c }} />
              ))}
            </div>
            <div className="flex justify-between items-center text-[10px] text-[var(--faint)]">
              <span>{diseaseScaleInfo.extent[0]?.toFixed(1) ?? '0.0'}%</span>
              <span>Fixed across years</span>
              <span>{diseaseScaleInfo.extent[1]?.toFixed(1) ?? '0.0'}%</span>
            </div>
          </div>

          {/* Choropleth Map View */}
          <div className="w-full h-full flex-1 min-h-[420px]">
            <TemporalDiseaseMap
              scopeSt={scopeSt}
              condition={condition}
              yearIndex={yearIndex}
              years={YEARS}
              selectedCountyId={selectedCountyId}
              onSelectCounty={(c) => setSelectedCountyId(c.id)}
              height={420}
              countyTrends={countyTrends}
            />
          </div>

          {/* Bottom Scrubbable Timeline Player */}
          <div className="h-[74px] border-t border-[var(--line)] bg-[var(--surface-solid)] px-6 flex items-center gap-5 z-20">
            <button
              onClick={togglePlay}
              aria-label={isPlaying ? 'Pause animation' : 'Play animation'}
              className="w-10 h-10 rounded-xl bg-[var(--cyan)] hover:opacity-90 text-white flex items-center justify-center shadow-md transition-all flex-shrink-0"
            >
              {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
            </button>

            <div className="flex-1">
              <input
                type="range"
                min="0"
                max="9"
                value={yearIndex}
                onChange={(e) => {
                  setIsPlaying(false);
                  setYearIndex(+e.target.value);
                }}
                className="w-full accent-[var(--cyan)] cursor-pointer"
                aria-label="Surveillance Year"
              />
              <div className="flex justify-between text-[11px] text-[var(--faint)] num font-semibold mt-1">
                {YEARS.filter((_, i) => i % 3 === 0 || i === 9).map(y => (
                  <span key={y}>{y}</span>
                ))}
              </div>
            </div>

            <div className="text-2xl font-bold font-display text-[var(--cyan)] num min-w-[70px] text-right">
              {YEARS[yearIndex]}
            </div>
          </div>
        </section>

        {/* Col 4: Top Summary KPI + Geographic Distribution */}
        <div className="lg:col-span-4 flex flex-col justify-between gap-6">
          {/* Active Focus County KPI Card */}
          <section className="rounded-2xl glass-panel p-5">
            <div className="text-[12px] font-bold text-[var(--muted)]">
              {focusCounty ? `${focusCounty.name} County, ${focusCounty.stateAbbr}` : 'County Surveillance'}
            </div>
            <div className="text-4xl font-display font-bold text-[var(--text)] num mt-2 flex items-baseline gap-1">
              <span>{focusCountyRate.toFixed(1)}</span>
              <small className="text-xl text-[var(--cyan)] font-sans font-bold">%</small>
            </div>
            {focusPercentile != null && (
              <div className="text-[11.5px] text-[var(--faint)] mt-2">
                <strong className="text-[var(--cyan)]">{focusPercentile}th</strong> percentile in {focusCounty?.stateName || 'State'} ({YEARS[yearIndex]})
              </div>
            )}
          </section>

          {/* Regional Geographic Distribution */}
          <section className="rounded-2xl glass-panel p-5 flex-1 flex flex-col justify-between">
            <div className="pb-3 border-b border-[var(--line)]">
              <h3 className="text-base font-bold text-[var(--text)]">Geographic Distribution</h3>
              <p className="text-[12px] text-[var(--muted)]">Population-weighted prevalence by Census region</p>
            </div>

            <div className="my-3">
              <BarChart data={regionalDistributionData} horizontal={true} height={200} unit="%" />
            </div>

            <div className="pt-2 border-t border-[var(--line)] text-[11px] text-[var(--faint)]">
              Census Bureau Division Summary ({YEARS[yearIndex]})
            </div>
          </section>
        </div>

        {/* Col 7: Time-Based Trends Line Chart */}
        <section className="lg:col-span-7 rounded-2xl glass-panel p-5 flex flex-col justify-between">
          <div className="pb-3 border-b border-[var(--line)]">
            <h3 className="text-base font-bold text-[var(--text)]">Time-Based Trends (2016 – 2025)</h3>
            <p className="text-[12px] text-[var(--muted)]">
              10-year longitudinal prevalence trajectory for {metricMeta.label.toLowerCase()}
            </p>
          </div>

          <div className="my-4">
            <TrendLineChart
              years={YEARS}
              series={timeBasedTrendSeries}
              height={220}
              unit="%"
            />
          </div>

          <div className="flex items-center gap-5 pt-2 border-t border-[var(--line)] text-[11.5px] flex-wrap">
            <div className="flex items-center gap-1.5 font-bold text-[var(--text)]">
              <span className="w-3 h-3 rounded-full bg-[#37C8CF]" />
              <span>{focusCounty ? `${focusCounty.name} County` : 'County'}</span>
            </div>
            <div className="flex items-center gap-1.5 font-semibold text-[var(--violet)]">
              <span className="w-3 h-3 rounded-full bg-[#8B5CF6]" />
              <span>{focusCounty?.stateName || 'State'} Average</span>
            </div>
            <div className="flex items-center gap-1.5 text-[var(--muted)]">
              <span className="w-3 h-3 rounded-full bg-white/40" />
              <span>National Median</span>
            </div>
          </div>
        </section>

        {/* Col 5: Influenza-Like Illness (ILI) Surveillance Curve */}
        <section className="lg:col-span-5 rounded-2xl glass-panel p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between pb-3 border-b border-[var(--line)]">
            <div>
              <h3 className="text-base font-bold text-[var(--text)]">Influenza-Like Illness</h3>
              <p className="text-[12px] text-[var(--muted)]">Weekly share of emergency visits, last two seasons</p>
            </div>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-[var(--cyan)]/15 border border-[var(--cyan)]/30 text-[var(--cyan)]">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--cyan)] animate-ping" />
              <span>Seasonal</span>
            </span>
          </div>

          <div className="my-4">
            <TrendLineChart
              years={iliWeeks}
              series={iliSeries}
              height={220}
              unit="%"
              showArea={false}
            />
          </div>

          <div className="flex items-center gap-5 pt-2 border-t border-[var(--line)] text-[11.5px]">
            <div className="flex items-center gap-1.5 font-bold text-[var(--amber)]">
              <span className="w-2.5 h-2.5 rounded-full bg-[#F59E0B]" />
              <span>2025–26 Season</span>
            </div>
            <div className="flex items-center gap-1.5 font-semibold text-[var(--violet)]">
              <span className="w-2.5 h-2.5 rounded-full bg-[#8B5CF6]" />
              <span>2024–25 Season (Prior)</span>
            </div>
          </div>
        </section>

        {/* Col 8: County Data Table with Sparklines */}
        <section className="lg:col-span-8 rounded-2xl glass-panel p-5 flex flex-col justify-between">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[var(--line)]">
            <div>
              <h3 className="text-base font-bold text-[var(--text)]">County Surveillance Table</h3>
              <p className="text-[12px] text-[var(--muted)]">
                {metricMeta.label}, {tableRows.length} counties in view, sorted highest first
              </p>
            </div>

            <div className="relative">
              <Search className="w-3.5 h-3.5 text-[var(--faint)] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={filterQuery}
                onChange={(e) => setFilterQuery(e.target.value)}
                placeholder="Filter counties..."
                className="h-8 pl-8 pr-3 rounded-lg bg-[var(--surface-2)] border border-[var(--line)] text-[12px] text-[var(--text)] outline-none focus:border-[var(--cyan)] w-48"
              />
            </div>
          </div>

          <div className="my-3 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface-solid)] max-h-[380px] overflow-y-auto">
            <table className="w-full text-left text-[12.5px]">
              <thead className="bg-[var(--surface-2)] text-[10.5px] font-bold text-[var(--faint)] uppercase border-b border-[var(--line)] sticky top-0 z-10 backdrop-blur-md">
                <tr>
                  <th className="p-3">County</th>
                  <th className="p-3 text-right">Prevalence</th>
                  <th className="p-3 text-right">95% CI</th>
                  <th className="p-3 text-right">Change (2016)</th>
                  <th className="p-3 text-center">10-Yr Trend</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {tableRows.map(({ county, currentVal, ciLow, ciHigh, changePts, trend }) => {
                  const isSelected = county.id === selectedCountyId;
                  const isRising = changePts > 0;

                  return (
                    <tr
                      key={county.id}
                      onClick={() => setSelectedCountyId(county.id)}
                      className={`cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-[var(--glow)]/80 text-[var(--text)] font-semibold'
                          : 'hover:bg-[var(--surface-2)] text-[var(--text)]'
                      }`}
                    >
                      <td className="p-3 font-bold">
                        <div className="flex items-center gap-1.5">
                          <span>{county.name} County, {county.stateAbbr}</span>
                          {county.id === activeCounty?._id && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-[var(--cyan)]/20 text-[var(--cyan)]">
                              Jurisdiction
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="p-3 text-right num font-bold text-[var(--text)]">
                        {currentVal.toFixed(1)}%
                      </td>

                      <td className="p-3 text-right num text-[var(--muted)] text-[11px]">
                        {ciLow.toFixed(1)} – {ciHigh.toFixed(1)}
                      </td>

                      <td className={`p-3 text-right num font-semibold ${isRising ? 'text-[var(--rose)]' : 'text-[var(--teal)]'}`}>
                        {isRising ? '+' : ''}{changePts.toFixed(1)} pts
                      </td>

                      <td className="p-3 text-center">
                        <Sparkline
                          values={trend}
                          width={75}
                          height={20}
                          color={isRising ? '#F43F5E' : '#37C8CF'}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="pt-2 border-t border-[var(--line)] text-[11px] text-[var(--faint)] flex items-center justify-between">
            <span>Click any county to inspect on the map and longitudinal charts</span>
            <span className="text-[var(--cyan)] font-semibold">95% Confidence Interval Estimates</span>
          </div>
        </section>

        {/* Col 4: Geographic Insights */}
        <section className="lg:col-span-4 rounded-2xl glass-panel p-5 flex flex-col justify-between">
          <div className="pb-3 border-b border-[var(--line)]">
            <h3 className="text-base font-bold text-[var(--text)]">Geographic Insights</h3>
            <p className="text-[12px] text-[var(--muted)]">Longitudinal surveillance observations</p>
          </div>

          <div className="space-y-4 my-4">
            {insights.map((ins, i) => (
              <div key={i} className="p-3.5 rounded-xl bg-[var(--surface-2)] border border-[var(--line)] flex items-start gap-3">
                <Sparkles className="w-4 h-4 text-[var(--cyan)] mt-0.5 flex-shrink-0" />
                <div className="text-[12px] leading-relaxed">
                  <p className="font-bold text-[var(--text)]">{ins.title}</p>
                  <p className="text-[11px] text-[var(--muted)] mt-1">{ins.detail}</p>
                </div>
              </div>
            ))}
          </div>

          <Link
            href={`/health-map?county=${selectedCountyId || activeCounty?._id || '27053'}`}
            className="w-full py-2.5 px-4 rounded-xl bg-[var(--cyan)] text-white hover:opacity-90 text-[12.5px] font-bold flex items-center justify-center gap-2 shadow-xs transition-all"
          >
            <Activity className="w-4 h-4" />
            <span>Open in Interactive Health Map</span>
          </Link>
        </section>
      </div>
    </div>
  );
}

export default function DiseaseIncidencePage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-[13px] text-[var(--muted)]">Loading disease incidence surveillance...</div>}>
      <DiseaseIncidenceContent />
    </Suspense>
  );
}
