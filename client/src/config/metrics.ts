export const METRICS_CONFIG: Record<string, { label: string; short: string; bad: 'high' | 'low'; unit: string; format: (v: number | null | undefined) => string }> = {
  svi: {
    label: 'Social Vulnerability Index',
    short: 'Vulnerability',
    bad: 'high',
    unit: 'index',
    format: (v) => v != null ? Number(v).toFixed(2) : 'N/A'
  },
  sdoh: {
    label: 'SDOH Composite Burden',
    short: 'SDOH Burden',
    bad: 'high',
    unit: '/100',
    format: (v) => v != null ? `${Number(v).toFixed(0)}/100` : 'N/A'
  },
  poverty: {
    label: 'Poverty Rate',
    short: 'Poverty',
    bad: 'high',
    unit: '%',
    format: (v) => v != null ? `${Number(v).toFixed(1)}%` : 'N/A'
  },
  uninsured: {
    label: 'Uninsured Rate',
    short: 'Uninsured',
    bad: 'high',
    unit: '%',
    format: (v) => v != null ? `${Number(v).toFixed(1)}%` : 'N/A'
  },
  diabetes: {
    label: 'Diabetes Prevalence',
    short: 'Diabetes',
    bad: 'high',
    unit: '%',
    format: (v) => v != null ? `${Number(v).toFixed(1)}%` : 'N/A'
  },
  hypertension: {
    label: 'Hypertension Prevalence',
    short: 'Hypertension',
    bad: 'high',
    unit: '%',
    format: (v) => v != null ? `${Number(v).toFixed(1)}%` : 'N/A'
  },
  asthma: {
    label: 'Asthma Prevalence',
    short: 'Asthma',
    bad: 'high',
    unit: '%',
    format: (v) => v != null ? `${Number(v).toFixed(1)}%` : 'N/A'
  },
  obesity: {
    label: 'Adult Obesity Prevalence',
    short: 'Obesity',
    bad: 'high',
    unit: '%',
    format: (v) => v != null ? `${Number(v).toFixed(1)}%` : 'N/A'
  },
  copd: {
    label: 'COPD Prevalence',
    short: 'COPD',
    bad: 'high',
    unit: '%',
    format: (v) => v != null ? `${Number(v).toFixed(1)}%` : 'N/A'
  },
  lifeExp: {
    label: 'Life Expectancy',
    short: 'Life Expectancy',
    bad: 'low',
    unit: 'years',
    format: (v) => v != null ? `${Number(v).toFixed(1)} yrs` : 'N/A'
  },
  access: {
    label: 'Healthcare Access Score',
    short: 'Access Score',
    bad: 'low',
    unit: 'score',
    format: (v) => v != null ? `${Number(v).toFixed(0)}/100` : 'N/A'
  },
  utilization: {
    label: 'Program Utilization Rate',
    short: 'Utilization',
    bad: 'low',
    unit: '%',
    format: (v) => v != null ? `${Number(v).toFixed(1)}%` : 'N/A'
  },
  noVehicle: {
    label: 'Households without a Vehicle',
    short: 'No Vehicle',
    bad: 'high',
    unit: '%',
    format: (v) => v != null ? `${Number(v).toFixed(1)}%` : 'N/A'
  },
  rentBurden: {
    label: 'Rent-Burdened Households',
    short: 'Rent Burden',
    bad: 'high',
    unit: '%',
    format: (v) => v != null ? `${Number(v).toFixed(1)}%` : 'N/A'
  },
  unemployment: {
    label: 'Unemployment Rate',
    short: 'Unemployment',
    bad: 'high',
    unit: '%',
    format: (v) => v != null ? `${Number(v).toFixed(1)}%` : 'N/A'
  },
  noDiploma: {
    label: 'Adults without High School Diploma',
    short: 'No Diploma',
    bad: 'high',
    unit: '%',
    format: (v) => v != null ? `${Number(v).toFixed(1)}%` : 'N/A'
  },
  pcp: {
    label: 'Primary Care Physicians per 100k',
    short: 'PCP per 100k',
    bad: 'low',
    unit: '',
    format: (v) => v != null ? `${Number(v).toFixed(0)}` : 'N/A'
  },
  driveTime: {
    label: 'Drive Time to Clinic',
    short: 'Drive Time',
    bad: 'high',
    unit: 'min',
    format: (v) => v != null ? `${Number(v).toFixed(0)} min` : 'N/A'
  }
};

export const MAP_LAYERS = [
  {
    id: 'sdoh',
    name: 'Social determinants of health',
    desc: 'Poverty, education, housing, employment',
    metrics: ['svi', 'poverty', 'noDiploma', 'rentBurden', 'unemployment', 'noVehicle'],
    ramp: ['#B5E3F2', '#66B6F5', '#2584EB', '#1A55B8', '#123A7D']
  },
  {
    id: 'disease',
    name: 'Disease incidence',
    desc: 'Chronic condition prevalence',
    metrics: ['diabetes', 'hypertension', 'asthma', 'obesity', 'copd'],
    ramp: ['#BDEFF0', '#37C8CF', '#2A9FD6', '#2565C8', '#173F8A']
  },
  {
    id: 'program',
    name: 'Program utilization',
    desc: 'Enrollment among eligible residents',
    metrics: ['utilization'],
    ramp: ['#B5E3F2', '#66B6F5', '#2584EB', '#1A55B8', '#123A7D']
  },
  {
    id: 'access',
    name: 'Healthcare access',
    desc: 'Coverage, clinicians, travel time',
    metrics: ['access', 'uninsured', 'pcp', 'driveTime'],
    ramp: ['#C6EAF7', '#7FC6F2', '#3B97E6', '#1F63C6', '#143F86']
  },
  {
    id: 'vuln',
    name: 'Community vulnerability',
    desc: 'Composite social vulnerability',
    metrics: ['svi', 'lifeExp'],
    ramp: ['#CDE7FB', '#8CC6F4', '#4C9BEA', '#2462C9', '#163A7E']
  }
];

export const TIER_LABELS = ['Very low', 'Low', 'Moderate', 'High', 'Very high'];
export const TIER_COLORS = ['#9FE3E7', '#5CCAD2', '#66B6F5', '#2584EB', '#163E8C'];

export const WORKFLOW_STEPS = [
  { id: 'dash', title: 'Open Dashboard', desc: 'Inspect county-level baseline indicators', route: '/' },
  { id: 'map', title: 'Explore Health Map', desc: 'Review geospatial distribution and hot spots', route: '/health-map' },
  { id: 'region', title: 'Change Jurisdiction', desc: 'Select your county or an analysis target', route: '/health-map' },
  { id: 'layer', title: 'Switch Map Layer', desc: 'Overlay social determinants or disease incidence', route: '/health-map' },
  { id: 'tract', title: 'Inspect Census Tract', desc: 'Examine population-level demographic drivers', route: '/census-tracts' },
  { id: 'compare', title: 'Compare Tracts', desc: 'Evaluate inequities side-by-side', route: '/census-tracts' },
  { id: 'flag', title: 'Flag Underserved Area', desc: 'Prioritize a high-vulnerability community', route: '/census-tracts' },
  { id: 'finding', title: 'Record Clinical Finding', desc: 'Attach observation to an assessment project', route: '/assessments' },
  { id: 'review', title: 'Review Assessment', desc: 'Track multi-step CHNA project progress', route: '/assessments' },
  { id: 'export', title: 'Export Board Report', desc: 'Download presentation-ready summary', route: '/reports' }
];
