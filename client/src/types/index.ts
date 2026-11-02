export type CountyFips = string; // e.g. "53033"
export type TractGeoid = string; // e.g. "53033011001"
export type StateFips = string; // e.g. "53"

export interface Jurisdiction {
  _id: CountyFips;
  name: string;
  stateFips: StateFips;
  stateName: string;
  stateAbbr: string;
  region: 'Northeast' | 'Midwest' | 'South' | 'West';
  population: number;
  svi: number;
  centroid: [number, number];
  bbox?: [number, number, number, number];
  indicators?: Record<string, number>;
  prog?: {
    wic: number;
    imm: number;
    dpp: number;
    tob: number;
    mhv: number;
  };
  completenessScore?: number;
  label?: string;
}

export interface CensusTract {
  _id: TractGeoid;
  countyFips: CountyFips;
  name: string;
  population: number;
  svi: number;
  tier: number; // 0..4
  centroid?: [number, number];
  geometry?: any;
  indicators?: Record<string, number>;
  prog?: {
    wic: number;
    imm: number;
    dpp: number;
    tob: number;
    mhv: number;
  };
  dataStatus?: 'adequate' | 'suppressed' | 'unstable';
  flagged?: boolean;
}

export interface Assessment {
  _id: string;
  title: string;
  jurisdictionId: CountyFips;
  status: 'Draft' | 'In review' | 'Completed' | 'Published';
  step: number; // 1..5
  indicators: string[];
  focusTracts: TractGeoid[];
  owner: string;
  due?: string;
  template?: 'chronic' | 'mch' | 'access' | 'custom';
  updatedAt?: string;
  createdAt?: string;
  findingsCount?: number;
  findings?: Finding[];
  focusTractsDetails?: CensusTract[];
}

export interface Finding {
  _id: string;
  assessmentId: string;
  tractId: TractGeoid;
  tractName?: string;
  countyLabel?: string;
  note: string;
  snapshot?: {
    svi: number;
    tier: string;
    poverty: number;
    uninsured: number;
    diabetes: number;
    access: number;
    lifeExp: number;
  };
  addedDate?: string;
  createdAt?: string;
}

export interface Report {
  _id: string;
  title: string;
  type: 'Vulnerability brief' | 'Program review' | 'Assessment summary';
  fromAssessmentId?: string | null;
  jurisdictionId: CountyFips;
  primaryMetric: string;
  status: 'Draft' | 'Published';
  focusTracts?: any[];
  findingsSnapshot?: string[];
  methodNote?: string;
  createdAt?: string;
  county?: Jurisdiction;
}

export interface UserSession {
  _id: string;
  activeJurisdiction: CountyFips;
  activeLayer: string;
  activeMetric: string;
  compareTracts: TractGeoid[];
  flaggedTracts: TractGeoid[];
  theme: 'light' | 'dark';
  trendWindowYears: number;
  workflowMilestones: Record<string, boolean>;
}

export interface DisparityAnalysis {
  metric: string;
  metricMeta: any;
  unitsCount: number;
  quintiles: {
    quintile: number;
    label: string;
    value: number;
    formatted: string;
  }[];
  disparityRatio: number;
  burdenHeldByTop20Pct: number;
  concentrationIndex: number;
  lorenzCurve: {
    cumulativePopulation: number;
    cumulativeBurden: number;
  }[];
  scope?: string;
  regionalAverages?: {
    region: string;
    value: number;
  }[];
}

export interface TrendSeries {
  metric: string;
  years: string[];
  series: {
    name: string;
    color: string;
    values: number[];
    dash?: string;
  }[];
}

export interface ResourceAllocation {
  county: string;
  totalFteAllocated: number;
  programKey: string;
  allocations: {
    tractId: TractGeoid;
    tractName: string;
    svi: number;
    baseUtilization: number;
    allocatedFte: number;
    projectedGain: number;
    projectedUtilization: number;
  }[];
}

export interface AuthUser {
  id: string;
  email: string;
  role: 'analyst' | 'manager' | 'admin';
  roleName: string;
  organization: string;
  avatar: string;
}
