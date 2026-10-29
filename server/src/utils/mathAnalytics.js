import { METRICS } from '../config/metrics.js';

/**
 * Weighted Mean of a metric over an array of geographical units (counties or tracts)
 */
export function weightedMean(units, metricKey) {
  if (!units || units.length === 0) return 0;
  let totalWeightedValue = 0;
  let totalPopulation = 0;

  for (const u of units) {
    const pop = u.population || 1;
    const val = getMetricValue(u, metricKey);
    if (val != null && !isNaN(val)) {
      totalWeightedValue += val * pop;
      totalPopulation += pop;
    }
  }

  return totalPopulation > 0 ? totalWeightedValue / totalPopulation : 0;
}

/**
 * Extracts a metric value safely from a unit (checking indicators Map or direct property)
 */
export function getMetricValue(unit, metricKey) {
  if (!unit) return null;
  if (unit.indicators) {
    if (typeof unit.indicators.get === 'function') {
      const v = unit.indicators.get(metricKey);
      if (v !== undefined) return v;
    } else if (unit.indicators[metricKey] !== undefined) {
      return unit.indicators[metricKey];
    }
  }
  if (unit.prog && metricKey.startsWith('prog.')) {
    const progKey = metricKey.replace('prog.', '');
    return unit.prog[progKey] ?? null;
  }
  return unit[metricKey] ?? null;
}

/**
 * Divides units into 5 population-sorted quintiles by SVI (Social Vulnerability Index)
 */
export function calculateQuintiles(units) {
  const sorted = [...units].sort((a, b) => (a.svi || 0) - (b.svi || 0));
  const n = sorted.length;
  if (n === 0) return [[], [], [], [], []];

  return [0, 1, 2, 3, 4].map(i => {
    const start = Math.floor((i * n) / 5);
    const end = Math.floor(((i + 1) * n) / 5);
    return sorted.slice(start, end);
  });
}

/**
 * Comprehensive Disparity Analysis
 * Handles Edge Cases:
 * - Inverted disparity ratio when 'bad: low' (Life Expectancy)
 * - Division by zero protection
 * - Concentration curve & Index calculation
 */
export function calculateDisparityAnalysis(units, metricKey) {
  const meta = METRICS[metricKey] || { bad: 'high', short: metricKey, label: metricKey };
  const quintiles = calculateQuintiles(units);
  const quintileAverages = quintiles.map(q => weightedMean(q, metricKey));

  // Disparity Ratio: Quintile 5 (most vulnerable) vs Quintile 1 (least vulnerable)
  const q1 = quintileAverages[0] || 0.0001;
  const q5 = quintileAverages[4] || 0.0001;

  let disparityRatio = 1.0;
  if (meta.bad === 'low') {
    // For positive metrics (e.g. Life Expectancy), Q1 (least vulnerable) / Q5 (most vulnerable)
    disparityRatio = q5 > 0 ? q1 / q5 : 1.0;
  } else {
    // For negative metrics (e.g. Poverty, Diabetes), Q5 (most vulnerable) / Q1 (least vulnerable)
    disparityRatio = q1 > 0 ? q5 / q1 : 1.0;
  }

  // Concentration Curve: Cumulative Population vs Cumulative Disease/Need Burden
  const sortedBySviDesc = [...units].sort((a, b) => (b.svi || 0) - (a.svi || 0));
  const totalPop = sortedBySviDesc.reduce((sum, u) => sum + (u.population || 1), 0);

  const burdenFn = (u) => {
    const val = getMetricValue(u, metricKey) || 0;
    return meta.bad === 'low' ? Math.max(0, 95 - val) : val;
  };

  const totalBurden = sortedBySviDesc.reduce((sum, u) => sum + (u.population || 1) * burdenFn(u), 0) || 1;

  let cumPop = 0;
  let cumBurden = 0;
  const lorenzPairs = [[0, 0]];

  for (const u of sortedBySviDesc) {
    const pop = u.population || 1;
    cumPop += pop;
    cumBurden += pop * burdenFn(u);
    lorenzPairs.push([cumPop / totalPop, cumBurden / totalBurden]);
  }

  // Downsample to max 50 points for smooth frontend charts
  const step = Math.max(1, Math.floor(lorenzPairs.length / 50));
  const sampledPairs = lorenzPairs.filter((_, idx) => idx % step === 0 || idx === lorenzPairs.length - 1);

  // Concentration Index (CI): 2 * Area between Lorenz curve and line of equality
  let ci = 0;
  for (let i = 1; i < sampledPairs.length; i++) {
    const [pPrev, bPrev] = sampledPairs[i - 1];
    const [pCur, bCur] = sampledPairs[i];
    ci += (pCur - pPrev) * ((bCur + bPrev) / 2);
  }
  const concentrationIndex = Math.min(1.0, Math.max(-1.0, 2 * ci - 1));

  // Share of burden held by the most vulnerable 20% of the population
  const top20Idx = lorenzPairs.findIndex(p => p[0] >= 0.2);
  let burdenHeldByTop20Pct = 20.0;
  if (top20Idx > 0) {
    const [pA, bA] = lorenzPairs[top20Idx - 1];
    const [pB, bB] = lorenzPairs[top20Idx];
    burdenHeldByTop20Pct = (bA + (bB - bA) * ((0.2 - pA) / (pB - pA))) * 100;
  }

  return {
    metric: metricKey,
    metricMeta: meta,
    unitsCount: units.length,
    quintiles: quintileAverages.map((val, idx) => ({
      quintile: idx + 1,
      label: `Quintile ${idx + 1}`,
      value: parseFloat(val.toFixed(2)),
      formatted: meta.format(val)
    })),
    disparityRatio: parseFloat(disparityRatio.toFixed(2)),
    burdenHeldByTop20Pct: parseFloat(burdenHeldByTop20Pct.toFixed(1)),
    concentrationIndex: parseFloat(concentrationIndex.toFixed(2)),
    lorenzCurve: sampledPairs.map(([x, y]) => ({
      cumulativePopulation: parseFloat((x * 100).toFixed(1)),
      cumulativeBurden: parseFloat((y * 100).toFixed(1))
    }))
  };
}

/**
 * Resource Allocation Simulation (Outreach FTE Diminishing-Returns Model)
 */
export function simulateResourceAllocation(tracts, fteCount = 6, programKey = 'all') {
  const metricKey = programKey === 'all' ? 'utilization' : `prog.${programKey}`;

  // Gap score = SVI * (100 - utilization)
  const scoredTracts = tracts.map(t => {
    const util = getMetricValue(t, metricKey) || 50;
    const gapScore = (t.svi || 0.5) * (100 - util);
    return {
      id: t._id,
      name: t.name,
      svi: t.svi,
      tier: t.tier,
      baseUtilization: util,
      gapScore
    };
  });

  // Pick top high-need gap tracts
  const topGaps = scoredTracts.sort((a, b) => b.gapScore - a.gapScore).slice(0, 8);
  const totalGapScore = topGaps.reduce((sum, g) => sum + g.gapScore, 0) || 1;

  const allocations = topGaps.map(g => {
    const fteShare = (fteCount * g.gapScore) / totalGapScore;
    // Diminishing returns formula: gain = (100 - base) * (1 - e^(-share * 0.22))
    const gain = (100 - g.baseUtilization) * (1 - Math.exp(-fteShare * 0.22));
    const projectedUtilization = Math.min(100, g.baseUtilization + gain);

    return {
      tractId: g.id,
      tractName: g.name,
      svi: g.svi,
      baseUtilization: parseFloat(g.baseUtilization.toFixed(1)),
      allocatedFte: parseFloat(fteShare.toFixed(1)),
      projectedGain: parseFloat(gain.toFixed(1)),
      projectedUtilization: parseFloat(projectedUtilization.toFixed(1))
    };
  });

  return {
    totalFteAllocated: fteCount,
    programKey,
    allocations
  };
}
