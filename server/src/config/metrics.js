/**
 * Centralized Health & Geospatial Indicators Configuration
 * 
 * EDGE CASE GUARD:
 * In public health analytics, indicators have opposite polarity:
 * - 'bad: high': Higher value indicates worse outcome (e.g. Poverty, Diabetes, Uninsured).
 * - 'bad: low': Higher value indicates better outcome (e.g. Life Expectancy, Median Income, Broadband).
 * Disparity ratios, quintile rankings, and color ramps MUST account for this polarity.
 */

export const METRICS = {
  svi: {
    key: 'svi',
    label: 'Social Vulnerability Index (SVI)',
    short: 'Vulnerability',
    domain: 'sdoh',
    bad: 'high',
    unit: 'index',
    min: 0,
    max: 1.0,
    format: (v) => (v != null && !isNaN(v) ? Number(v).toFixed(2) : 'N/A')
  },
  poverty: {
    key: 'poverty',
    label: 'Poverty rate (% below FPL)',
    short: 'Poverty',
    domain: 'sdoh',
    bad: 'high',
    unit: '%',
    min: 0,
    max: 100,
    format: (v) => (v != null && !isNaN(v) ? `${Number(v).toFixed(1)}%` : 'N/A')
  },
  childPoverty: {
    key: 'childPoverty',
    label: 'Child poverty rate (%)',
    short: 'Child poverty',
    domain: 'sdoh',
    bad: 'high',
    unit: '%',
    min: 0,
    max: 100,
    format: (v) => (v != null && !isNaN(v) ? `${Number(v).toFixed(1)}%` : 'N/A')
  },
  income: {
    key: 'income',
    label: 'Median household income',
    short: 'Median income',
    domain: 'sdoh',
    bad: 'low',
    unit: '$',
    min: 15000,
    max: 180000,
    format: (v) => (v != null && !isNaN(v) ? `$${Number(v).toLocaleString()}` : 'N/A')
  },
  rentBurden: {
    key: 'rentBurden',
    label: 'Severe rent burden (% paying >50% income)',
    short: 'Rent burden',
    domain: 'sdoh',
    bad: 'high',
    unit: '%',
    min: 0,
    max: 100,
    format: (v) => (v != null && !isNaN(v) ? `${Number(v).toFixed(1)}%` : 'N/A')
  },
  oldHousing: {
    key: 'oldHousing',
    label: 'Older housing built before 1960 (%)',
    short: 'Old housing',
    domain: 'sdoh',
    bad: 'high',
    unit: '%',
    min: 0,
    max: 100,
    format: (v) => (v != null && !isNaN(v) ? `${Number(v).toFixed(1)}%` : 'N/A')
  },
  crowding: {
    key: 'crowding',
    label: 'Overcrowded housing units (%)',
    short: 'Crowding',
    domain: 'sdoh',
    bad: 'high',
    unit: '%',
    min: 0,
    max: 100,
    format: (v) => (v != null && !isNaN(v) ? `${Number(v).toFixed(1)}%` : 'N/A')
  },
  noVehicle: {
    key: 'noVehicle',
    label: 'Households with no vehicle available (%)',
    short: 'No vehicle',
    domain: 'sdoh',
    bad: 'high',
    unit: '%',
    min: 0,
    max: 100,
    format: (v) => (v != null && !isNaN(v) ? `${Number(v).toFixed(1)}%` : 'N/A')
  },
  transit: {
    key: 'transit',
    label: 'Public transit commute share (%)',
    short: 'Transit share',
    domain: 'sdoh',
    bad: 'low',
    unit: '%',
    min: 0,
    max: 100,
    format: (v) => (v != null && !isNaN(v) ? `${Number(v).toFixed(1)}%` : 'N/A')
  },
  commute: {
    key: 'commute',
    label: 'Mean commute time (minutes)',
    short: 'Commute time',
    domain: 'sdoh',
    bad: 'high',
    unit: 'min',
    min: 5,
    max: 90,
    format: (v) => (v != null && !isNaN(v) ? `${Number(v).toFixed(1)} min` : 'N/A')
  },
  noDiploma: {
    key: 'noDiploma',
    label: 'Adults without high school diploma (%)',
    short: 'No diploma',
    domain: 'sdoh',
    bad: 'high',
    unit: '%',
    min: 0,
    max: 100,
    format: (v) => (v != null && !isNaN(v) ? `${Number(v).toFixed(1)}%` : 'N/A')
  },
  bachelors: {
    key: 'bachelors',
    label: "Adults with bachelor's degree or higher (%)",
    short: 'Higher ed',
    domain: 'sdoh',
    bad: 'low',
    unit: '%',
    min: 0,
    max: 100,
    format: (v) => (v != null && !isNaN(v) ? `${Number(v).toFixed(1)}%` : 'N/A')
  },
  broadband: {
    key: 'broadband',
    label: 'Households with broadband subscription (%)',
    short: 'Broadband',
    domain: 'sdoh',
    bad: 'low',
    unit: '%',
    min: 0,
    max: 100,
    format: (v) => (v != null && !isNaN(v) ? `${Number(v).toFixed(1)}%` : 'N/A')
  },
  unemployment: {
    key: 'unemployment',
    label: 'Civilian unemployment rate (%)',
    short: 'Unemployment',
    domain: 'sdoh',
    bad: 'high',
    unit: '%',
    min: 0,
    max: 100,
    format: (v) => (v != null && !isNaN(v) ? `${Number(v).toFixed(1)}%` : 'N/A')
  },
  lfp: {
    key: 'lfp',
    label: 'Labor force participation rate (%)',
    short: 'Labor participation',
    domain: 'sdoh',
    bad: 'low',
    unit: '%',
    min: 0,
    max: 100,
    format: (v) => (v != null && !isNaN(v) ? `${Number(v).toFixed(1)}%` : 'N/A')
  },
  uninsured: {
    key: 'uninsured',
    label: 'Uninsured population (%)',
    short: 'Uninsured',
    domain: 'access',
    bad: 'high',
    unit: '%',
    min: 0,
    max: 100,
    format: (v) => (v != null && !isNaN(v) ? `${Number(v).toFixed(1)}%` : 'N/A')
  },
  pcp: {
    key: 'pcp',
    label: 'Primary care physicians per 100k',
    short: 'Physicians/100k',
    domain: 'access',
    bad: 'low',
    unit: 'per 100k',
    min: 0,
    max: 300,
    format: (v) => (v != null && !isNaN(v) ? Number(v).toFixed(0) : 'N/A')
  },
  driveTime: {
    key: 'driveTime',
    label: 'Drive time to nearest hospital (minutes)',
    short: 'Hospital drive time',
    domain: 'access',
    bad: 'high',
    unit: 'min',
    min: 1,
    max: 120,
    format: (v) => (v != null && !isNaN(v) ? `${Number(v).toFixed(0)} min` : 'N/A')
  },
  access: {
    key: 'access',
    label: 'Healthcare accessibility score (0-100)',
    short: 'Access score',
    domain: 'access',
    bad: 'low',
    unit: 'score',
    min: 0,
    max: 100,
    format: (v) => (v != null && !isNaN(v) ? Number(v).toFixed(0) : 'N/A')
  },
  diabetes: {
    key: 'diabetes',
    label: 'Adult diagnosed diabetes prevalence (%)',
    short: 'Diabetes',
    domain: 'chronic',
    bad: 'high',
    unit: '%',
    min: 0,
    max: 100,
    format: (v) => (v != null && !isNaN(v) ? `${Number(v).toFixed(1)}%` : 'N/A')
  },
  hypertension: {
    key: 'hypertension',
    label: 'Adult hypertension prevalence (%)',
    short: 'Hypertension',
    domain: 'chronic',
    bad: 'high',
    unit: '%',
    min: 0,
    max: 100,
    format: (v) => (v != null && !isNaN(v) ? `${Number(v).toFixed(1)}%` : 'N/A')
  },
  asthma: {
    key: 'asthma',
    label: 'Adult current asthma prevalence (%)',
    short: 'Asthma',
    domain: 'chronic',
    bad: 'high',
    unit: '%',
    min: 0,
    max: 100,
    format: (v) => (v != null && !isNaN(v) ? `${Number(v).toFixed(1)}%` : 'N/A')
  },
  obesity: {
    key: 'obesity',
    label: 'Adult obesity prevalence (BMI >= 30) (%)',
    short: 'Obesity',
    domain: 'chronic',
    bad: 'high',
    unit: '%',
    min: 0,
    max: 100,
    format: (v) => (v != null && !isNaN(v) ? `${Number(v).toFixed(1)}%` : 'N/A')
  },
  copd: {
    key: 'copd',
    label: 'Chronic obstructive pulmonary disease (%)',
    short: 'COPD',
    domain: 'chronic',
    bad: 'high',
    unit: '%',
    min: 0,
    max: 100,
    format: (v) => (v != null && !isNaN(v) ? `${Number(v).toFixed(1)}%` : 'N/A')
  },
  lifeExp: {
    key: 'lifeExp',
    label: 'Life expectancy at birth (years)',
    short: 'Life expectancy',
    domain: 'chronic',
    bad: 'low',
    unit: 'years',
    min: 55,
    max: 95,
    format: (v) => (v != null && !isNaN(v) ? `${Number(v).toFixed(1)} yrs` : 'N/A')
  },
  utilization: {
    key: 'utilization',
    label: 'Overall program utilization rate (%)',
    short: 'Program utilization',
    domain: 'program',
    bad: 'low',
    unit: '%',
    min: 0,
    max: 100,
    format: (v) => (v != null && !isNaN(v) ? `${Number(v).toFixed(1)}%` : 'N/A')
  },
  'prog.wic': {
    key: 'prog.wic',
    label: 'WIC enrollment among eligible (%)',
    short: 'WIC enrollment',
    domain: 'program',
    bad: 'low',
    unit: '%',
    min: 0,
    max: 100,
    format: (v) => (v != null && !isNaN(v) ? `${Number(v).toFixed(0)}%` : 'N/A')
  },
  'prog.imm': {
    key: 'prog.imm',
    label: 'Childhood immunization complete series (%)',
    short: 'Immunization',
    domain: 'program',
    bad: 'low',
    unit: '%',
    min: 0,
    max: 100,
    format: (v) => (v != null && !isNaN(v) ? `${Number(v).toFixed(0)}%` : 'N/A')
  },
  'prog.dpp': {
    key: 'prog.dpp',
    label: 'Diabetes prevention program participation (%)',
    short: 'Diabetes prevention',
    domain: 'program',
    bad: 'low',
    unit: '%',
    min: 0,
    max: 100,
    format: (v) => (v != null && !isNaN(v) ? `${Number(v).toFixed(0)}%` : 'N/A')
  },
  'prog.tob': {
    key: 'prog.tob',
    label: 'Tobacco cessation program completion (%)',
    short: 'Tobacco cessation',
    domain: 'program',
    bad: 'low',
    unit: '%',
    min: 0,
    max: 100,
    format: (v) => (v != null && !isNaN(v) ? `${Number(v).toFixed(0)}%` : 'N/A')
  },
  'prog.mhv': {
    key: 'prog.mhv',
    label: 'Maternal & infant home visiting enrollment (%)',
    short: 'Home visiting',
    domain: 'program',
    bad: 'low',
    unit: '%',
    min: 0,
    max: 100,
    format: (v) => (v != null && !isNaN(v) ? `${Number(v).toFixed(0)}%` : 'N/A')
  }
};

export const TIER_LABELS = ['Very low', 'Low', 'Moderate', 'High', 'Very high'];
export const TIER_COLORS = ['#9FE3E7', '#5CCAD2', '#66B6F5', '#2584EB', '#163E8C'];
