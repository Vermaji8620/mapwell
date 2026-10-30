import * as d3 from 'd3';
import * as topojson from 'topojson-client';

export interface CountyRecord {
  id: string;
  name: string;
  st: string;
  stateName: string;
  stateAbbr: string;
  region: string;
  pop: number;
  urban: number;
  svi: number;
  d?: string;
  feature?: any;
  indicators: {
    svi: number;
    poverty: number;
    childPoverty: number;
    income: number;
    rentBurden: number;
    oldHousing: number;
    crowding: number;
    noVehicle: number;
    transit: number;
    commute: number;
    noDiploma: number;
    bachelors: number;
    broadband: number;
    unemployment: number;
    lfp: number;
    uninsured: number;
    pcp: number;
    driveTime: number;
    diabetes: number;
    asthma: number;
    hypertension: number;
    obesity: number;
    copd: number;
    lifeExp: number;
    access: number;
    sdoh: number;
    incidence: number;
    utilization: number;
  };
}

export const STATE_META: Record<string, [string, string, string]> = {
  '01': ['AL', 'Alabama', 'South'],
  '02': ['AK', 'Alaska', 'West'],
  '04': ['AZ', 'Arizona', 'West'],
  '05': ['AR', 'Arkansas', 'South'],
  '06': ['CA', 'California', 'West'],
  '08': ['CO', 'Colorado', 'West'],
  '09': ['CT', 'Connecticut', 'Northeast'],
  '10': ['DE', 'Delaware', 'South'],
  '11': ['DC', 'District of Columbia', 'South'],
  '12': ['FL', 'Florida', 'South'],
  '13': ['GA', 'Georgia', 'South'],
  '15': ['HI', 'Hawaii', 'West'],
  '16': ['ID', 'Idaho', 'West'],
  '17': ['IL', 'Illinois', 'Midwest'],
  '18': ['IN', 'Indiana', 'Midwest'],
  '19': ['IA', 'Iowa', 'Midwest'],
  '20': ['KS', 'Kansas', 'Midwest'],
  '21': ['KY', 'Kentucky', 'South'],
  '22': ['LA', 'Louisiana', 'South'],
  '23': ['ME', 'Maine', 'Northeast'],
  '24': ['MD', 'Maryland', 'South'],
  '25': ['MA', 'Massachusetts', 'Northeast'],
  '26': ['MI', 'Michigan', 'Midwest'],
  '27': ['MN', 'Minnesota', 'Midwest'],
  '28': ['MS', 'Mississippi', 'South'],
  '29': ['MO', 'Missouri', 'Midwest'],
  '30': ['MT', 'Montana', 'West'],
  '31': ['NE', 'Nebraska', 'Midwest'],
  '32': ['NV', 'Nevada', 'West'],
  '33': ['NH', 'New Hampshire', 'Northeast'],
  '34': ['NJ', 'New Jersey', 'Northeast'],
  '35': ['NM', 'New Mexico', 'West'],
  '36': ['NY', 'New York', 'Northeast'],
  '37': ['NC', 'North Carolina', 'South'],
  '38': ['ND', 'North Dakota', 'Midwest'],
  '39': ['OH', 'Ohio', 'Midwest'],
  '40': ['OK', 'Oklahoma', 'South'],
  '41': ['OR', 'Oregon', 'West'],
  '42': ['PA', 'Pennsylvania', 'Northeast'],
  '44': ['RI', 'Rhode Island', 'Northeast'],
  '45': ['SC', 'South Carolina', 'South'],
  '46': ['SD', 'South Dakota', 'Midwest'],
  '47': ['TN', 'Tennessee', 'South'],
  '48': ['TX', 'Texas', 'South'],
  '49': ['UT', 'Utah', 'West'],
  '50': ['VT', 'Vermont', 'Northeast'],
  '51': ['VA', 'Virginia', 'South'],
  '53': ['WA', 'Washington', 'West'],
  '54': ['WV', 'West Virginia', 'South'],
  '55': ['WI', 'Wisconsin', 'Midwest'],
  '56': ['WY', 'Wyoming', 'West']
};

const BLOBS: [number, number, number, number][] = [
  [610, 390, 85, 0.55],
  [700, 300, 70, 0.5],
  [300, 470, 110, 0.45],
  [430, 230, 60, 0.35],
  [560, 470, 70, 0.4],
  [760, 400, 60, 0.35],
  [200, 360, 70, 0.3],
  [520, 330, 60, 0.25],
  [140, 520, 60, 0.4],
  [850, 190, -90, -0.35],
  [150, 120, -80, -0.3],
  [470, 110, -80, -0.25],
  [820, 300, -50, -0.3],
  [250, 250, -70, -0.2]
];

function needField(x: number, y: number): number {
  let v = 0.32;
  for (const [bx, by, r, w] of BLOBS) {
    const rr = Math.abs(r);
    v += w * Math.exp(-((x - bx) ** 2 + (y - by) ** 2) / (rr * rr));
  }
  v += 0.06 * Math.sin(x / 47) * Math.cos(y / 39) + 0.04 * Math.sin((x + y) / 23);
  return v;
}

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

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const METRO_POP: Record<string, number> = {
  '06037': 9800000, '17031': 5200000, '48201': 4700000, '04013': 4400000,
  '06073': 3300000, '06059': 3200000, '12086': 2700000, '36047': 2700000,
  '48113': 2600000, '36081': 2400000, '06065': 2400000, '53033': 2270000,
  '32003': 2260000, '06071': 2180000, '48439': 2100000, '48029': 2000000,
  '12011': 1940000, '06085': 1930000, '26163': 1790000, '36061': 1690000,
  '25017': 1630000, '42101': 1600000, '12099': 1490000, '06001': 1680000,
  '39035': 1260000, '27053': 1280000, '42003': 1250000, '49035': 1180000,
  '41051': 815000, '11001': 690000
};

let cachedRepository: {
  counties: CountyRecord[];
  countyById: Map<string, CountyRecord>;
  countiesByState: Map<string, CountyRecord[]>;
} | null = null;

export async function getCountyRepository(): Promise<{
  counties: CountyRecord[];
  countyById: Map<string, CountyRecord>;
  countiesByState: Map<string, CountyRecord[]>;
}> {
  if (cachedRepository) return cachedRepository;

  const res = await fetch('/us-counties.json');
  const geo = await res.json();
  const path = d3.geoPath();

  const countyFeatures = (topojson.feature(geo, geo.objects.counties) as any).features.filter(
    (f: any) => STATE_META[f.id.toString().padStart(5, '0').slice(0, 2)] && path(f)
  );

  const counties: CountyRecord[] = [];
  const countyById = new Map<string, CountyRecord>();
  const countiesByState = new Map<string, CountyRecord[]>();

  countyFeatures.forEach((f: any) => {
    const fips = f.id.toString().padStart(5, '0');
    const st = fips.slice(0, 2);
    const meta = STATE_META[st];
    if (!meta) return;

    const centroid = path.centroid(f);
    const area = path.area(f);
    const r = rngGen(hashStr(fips));
    const n = () => gaussRand(r);

    const D = clamp(needField(centroid[0], centroid[1]) + n() * 0.09, 0.02, 0.98);
    const urban = METRO_POP[fips] ? 0.95 : clamp(1 - Math.log(area + 1) / 6.5 + n() * 0.15, 0, 1);
    const pop = METRO_POP[fips] || Math.round(clamp(Math.exp(9.4 + urban * 3.6 + n() * 0.7), 900, 9e5));

    const poverty = clamp(6 + 24 * D + n() * 2.4, 3, 42);
    const childPoverty = clamp(poverty * 1.42 + n() * 2, 4, 58);
    const income = clamp(96000 - 58000 * D + 22000 * urban + n() * 5000, 26000, 160000);
    const rentBurden = clamp(20 + 16 * D + urban * 9 + n() * 3, 10, 62);
    const oldHousing = clamp(18 + 22 * (1 - urban) * 0.6 + 14 * D + n() * 6, 4, 70);
    const crowding = clamp(1 + 6 * D * urban + n() * 1.1, 0.2, 14);
    const noVehicle = clamp(3 + 9 * D + 7 * urban + n() * 1.5, 0.6, 30);
    const transit = clamp(8 + 62 * urban - 20 * D + n() * 8, 0, 96);
    const commute = clamp(21 + 9 * (1 - urban) + 6 * D + n() * 3, 12, 48);
    const noDiploma = clamp(5 + 17 * D + n() * 2.2, 2, 36);
    const bachelors = clamp(44 - 26 * D + 12 * urban + n() * 4, 8, 74);
    const broadband = clamp(93 - 22 * D - 12 * (1 - urban) + n() * 3, 52, 99);
    const unemployment = clamp(2.6 + 6.4 * D + n() * 0.9, 1.4, 15);
    const lfp = clamp(70 - 16 * D + n() * 3, 44, 80);
    const uninsured = clamp(4 + 15 * D + n() * 2, 2, 32);
    const pcp = clamp(118 - 74 * D - 30 * (1 - urban) + n() * 12, 12, 190);
    const driveTime = clamp(9 + 26 * (1 - urban) + 10 * D + n() * 4, 4, 75);
    const diabetes = clamp(7 + 8.5 * D + n() * 0.8, 5, 21);
    const asthma = clamp(8.4 + 3.2 * D + 1.1 * urban + n() * 0.5, 6.5, 15);
    const hypertension = clamp(27 + 15 * D + n() * 1.8, 20, 50);
    const obesity = clamp(27 + 15 * D - 3 * urban + n() * 2, 20, 50);
    const copd = clamp(5 + 7 * D + 1.5 * (1 - urban) + n() * 0.7, 3, 17);
    const lifeExp = clamp(81.5 - 8.5 * D + n() * 0.8, 66, 86);

    const access = clamp(100 - (uninsured * 1.6 + driveTime * 0.6 + (190 - pcp) * 0.2), 5, 98);
    const sdoh = clamp((poverty / 42 * 0.3 + noDiploma / 36 * 0.2 + unemployment / 15 * 0.2 + rentBurden / 62 * 0.15 + noVehicle / 30 * 0.15) * 100, 0, 100);
    const incidence = clamp((diabetes - 5) / 16 * 100 * 0.6 + (hypertension - 20) / 30 * 100 * 0.4, 0, 100);

    const PU = (base: number, sens: number) => clamp(base * (1 - sens * D) + n() * 6 + urban * 5, 3, 96);
    const utilization = (PU(62, 0.55) + PU(78, 0.35) + PU(38, 0.7) + PU(31, 0.6) + PU(44, 0.65)) / 5;

    const svi = clamp(D * 1.02 + n() * 0.07, 0.01, 0.99);

    const rec: CountyRecord = {
      id: fips,
      name: f.properties?.name || `County ${fips}`,
      st,
      stateAbbr: meta[0],
      stateName: meta[1],
      region: meta[2],
      pop,
      urban,
      svi,
      feature: f,
      indicators: {
        svi,
        poverty,
        childPoverty,
        income,
        rentBurden,
        oldHousing,
        crowding,
        noVehicle,
        transit,
        commute,
        noDiploma,
        bachelors,
        broadband,
        unemployment,
        lfp,
        uninsured,
        pcp,
        driveTime,
        diabetes,
        asthma,
        hypertension,
        obesity,
        copd,
        lifeExp,
        access,
        sdoh,
        incidence,
        utilization
      }
    };

    counties.push(rec);
    countyById.set(fips, rec);

    if (!countiesByState.has(st)) {
      countiesByState.set(st, []);
    }
    countiesByState.get(st)!.push(rec);
  });

  cachedRepository = {
    counties,
    countyById,
    countiesByState
  };

  return cachedRepository;
}
