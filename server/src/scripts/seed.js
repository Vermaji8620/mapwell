import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../config/db.js';
import { Jurisdiction } from '../models/Jurisdiction.js';
import { CensusTract } from '../models/CensusTract.js';
import { Assessment } from '../models/Assessment.js';
import { Finding } from '../models/Finding.js';
import { Report } from '../models/Report.js';
import { DataSource, ImportLog, ProcessingError } from '../models/DataManagement.js';
import { UserSession } from '../models/UserSession.js';

// Deterministic Pseudo-Random Generator for repeatable seed figures
function pseudoRandom(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return function () {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

const COUNTIES_SEED = [
  { id: '53033', name: 'King County', st: '53', stateName: 'Washington', stateAbbr: 'WA', region: 'West', pop: 2270000, svi: 0.38, centroid: [-121.9, 47.5], poverty: 10.2, uninsured: 6.4, diabetes: 7.8, hypertension: 24.1, asthma: 8.9, obesity: 26.3, copd: 4.8, lifeExp: 81.6, wic: 74, imm: 82, dpp: 46, tob: 38, mhv: 52 },
  { id: '17031', name: 'Cook County', st: '17', stateName: 'Illinois', stateAbbr: 'IL', region: 'Midwest', pop: 5200000, svi: 0.62, centroid: [-87.7, 41.8], poverty: 14.8, uninsured: 8.6, diabetes: 11.2, hypertension: 32.4, asthma: 10.5, obesity: 32.8, copd: 6.9, lifeExp: 78.4, wic: 68, imm: 79, dpp: 38, tob: 32, mhv: 45 },
  { id: '06037', name: 'Los Angeles County', st: '06', stateName: 'California', stateAbbr: 'CA', region: 'West', pop: 9800000, svi: 0.68, centroid: [-118.2, 34.1], poverty: 14.1, uninsured: 9.8, diabetes: 10.6, hypertension: 28.5, asthma: 8.4, obesity: 28.9, copd: 4.5, lifeExp: 81.2, wic: 71, imm: 81, dpp: 42, tob: 29, mhv: 48 },
  { id: '48201', name: 'Harris County', st: '48', stateName: 'Texas', stateAbbr: 'TX', region: 'South', pop: 4700000, svi: 0.65, centroid: [-95.4, 29.8], poverty: 15.6, uninsured: 21.2, diabetes: 12.4, hypertension: 33.1, asthma: 9.2, obesity: 34.6, copd: 5.8, lifeExp: 78.9, wic: 64, imm: 75, dpp: 34, tob: 28, mhv: 39 },
  { id: '04013', name: 'Maricopa County', st: '04', stateName: 'Arizona', stateAbbr: 'AZ', region: 'West', pop: 4400000, svi: 0.54, centroid: [-112.1, 33.4], poverty: 12.8, uninsured: 11.4, diabetes: 10.1, hypertension: 29.8, asthma: 9.6, obesity: 30.7, copd: 6.2, lifeExp: 79.5, wic: 66, imm: 77, dpp: 40, tob: 35, mhv: 44 },
  { id: '13121', name: 'Fulton County', st: '13', stateName: 'Georgia', stateAbbr: 'GA', region: 'South', pop: 1060000, svi: 0.56, centroid: [-84.4, 33.7], poverty: 13.9, uninsured: 12.2, diabetes: 11.5, hypertension: 34.2, asthma: 10.1, obesity: 31.9, copd: 5.9, lifeExp: 79.1, wic: 69, imm: 80, dpp: 39, tob: 31, mhv: 46 },
  { id: '36061', name: 'New York County', st: '36', stateName: 'New York', stateAbbr: 'NY', region: 'Northeast', pop: 1690000, svi: 0.44, centroid: [-73.9, 40.7], poverty: 15.1, uninsured: 5.8, diabetes: 8.9, hypertension: 25.6, asthma: 11.2, obesity: 23.4, copd: 4.9, lifeExp: 82.5, wic: 76, imm: 85, dpp: 48, tob: 41, mhv: 56 },
  { id: '25025', name: 'Suffolk County', st: '25', stateName: 'Massachusetts', stateAbbr: 'MA', region: 'Northeast', pop: 790000, svi: 0.58, centroid: [-71.0, 42.3], poverty: 16.8, uninsured: 4.2, diabetes: 9.7, hypertension: 28.1, asthma: 12.4, obesity: 27.2, copd: 5.7, lifeExp: 80.8, wic: 78, imm: 88, dpp: 50, tob: 43, mhv: 59 },
  { id: '27053', name: 'Hennepin County', st: '27', stateName: 'Minnesota', stateAbbr: 'MN', region: 'Midwest', pop: 1280000, svi: 0.41, centroid: [-93.3, 45.0], poverty: 11.4, uninsured: 5.1, diabetes: 8.1, hypertension: 24.8, asthma: 8.8, obesity: 26.9, copd: 4.6, lifeExp: 81.4, wic: 75, imm: 84, dpp: 47, tob: 39, mhv: 53 },
  { id: '08031', name: 'Denver County', st: '08', stateName: 'Colorado', stateAbbr: 'CO', region: 'West', pop: 715000, svi: 0.49, centroid: [-104.9, 39.7], poverty: 12.1, uninsured: 8.9, diabetes: 8.4, hypertension: 25.1, asthma: 9.1, obesity: 24.8, copd: 5.1, lifeExp: 80.5, wic: 72, imm: 83, dpp: 45, tob: 37, mhv: 51 }
];

export async function seedDatabase() {
  console.log('[Seeding Database] Initializing MapWell core records...');

  // 1. Clear existing records
  await Promise.all([
    Jurisdiction.deleteMany({}),
    CensusTract.deleteMany({}),
    Assessment.deleteMany({}),
    Finding.deleteMany({}),
    Report.deleteMany({}),
    DataSource.deleteMany({}),
    ImportLog.deleteMany({}),
    ProcessingError.deleteMany({}),
    UserSession.deleteMany({})
  ]);

  // 2. Insert Jurisdictions
  const jurisdictions = COUNTIES_SEED.map(c => ({
    _id: c.id,
    name: c.name,
    stateFips: c.st,
    stateName: c.stateName,
    stateAbbr: c.stateAbbr,
    region: c.region,
    population: c.pop,
    svi: c.svi,
    centroid: c.centroid,
    bbox: [c.centroid[0] - 0.4, c.centroid[1] - 0.3, c.centroid[0] + 0.4, c.centroid[1] + 0.3],
    indicators: {
      svi: c.svi,
      poverty: c.poverty,
      childPoverty: c.poverty * 1.3,
      income: Math.round(95000 - c.poverty * 2500),
      rentBurden: c.poverty * 2.2 + 15,
      oldHousing: 35.4,
      crowding: 4.8,
      noVehicle: c.poverty * 0.9,
      transit: 18.2,
      commute: 28.4,
      noDiploma: c.poverty * 0.7 + 3,
      bachelors: 42.5,
      broadband: 89.2,
      unemployment: c.poverty * 0.4 + 2,
      lfp: 68.5,
      uninsured: c.uninsured,
      pcp: 142,
      driveTime: 12,
      access: 84,
      diabetes: c.diabetes,
      hypertension: c.hypertension,
      asthma: c.asthma,
      obesity: c.obesity,
      copd: c.copd,
      lifeExp: c.lifeExp,
      utilization: Math.round((c.wic + c.imm + c.dpp + c.tob + c.mhv) / 5)
    },
    prog: {
      wic: c.wic,
      imm: c.imm,
      dpp: c.dpp,
      tob: c.tob,
      mhv: c.mhv
    },
    completenessScore: 98.4
  }));

  await Jurisdiction.insertMany(jurisdictions);
  console.log(`[Seed] Inserted ${jurisdictions.length} jurisdictions.`);

  // 3. Generate Census Tracts for Jurisdictions
  const tracts = [];
  for (const c of COUNTIES_SEED) {
    const tractCount = c.id === '53033' ? 84 : 45; // Comprehensive tract count for King County
    const rng = pseudoRandom(parseInt(c.id, 10));

    for (let i = 1; i <= tractCount; i++) {
      // 11-digit GEOID: 2-digit state + 3-digit county + 6-digit tract (e.g. 53033011001)
      const tractNumStr = String(i * 100 + 1).padStart(6, '0');
      const geoid = `${c.id}${tractNumStr}`;

      const randOffset = (rng() - 0.5) * 0.4;
      const tractSvi = Math.min(0.99, Math.max(0.02, c.svi + randOffset));
      const tier = Math.min(4, Math.floor(tractSvi * 5)); // 0 to 4

      const tractPoverty = Math.max(2, c.poverty + (tractSvi - 0.5) * 20 + (rng() - 0.5) * 4);
      const tractUninsured = Math.max(2, c.uninsured + (tractSvi - 0.5) * 12 + (rng() - 0.5) * 3);
      const tractDiabetes = Math.max(3, c.diabetes + (tractSvi - 0.5) * 9 + (rng() - 0.5) * 2);
      const tractLifeExp = Math.max(65, c.lifeExp - (tractSvi - 0.5) * 8 + (rng() - 0.5) * 2);
      const countyUtil = (c.wic + c.imm + c.dpp + c.tob + c.mhv) / 5;

      tracts.push({
        _id: geoid,
        countyFips: c.id,
        name: `Census Tract ${i * 10}.01`,
        population: Math.round(2500 + rng() * 4500),
        svi: parseFloat(tractSvi.toFixed(2)),
        tier,
        centroid: [c.centroid[0] + (rng() - 0.5) * 0.3, c.centroid[1] + (rng() - 0.5) * 0.3],
        indicators: {
          svi: parseFloat(tractSvi.toFixed(2)),
          poverty: parseFloat(tractPoverty.toFixed(1)),
          childPoverty: parseFloat((tractPoverty * 1.25).toFixed(1)),
          income: Math.round(85000 - tractPoverty * 2000),
          rentBurden: parseFloat((tractPoverty * 2.1 + 12).toFixed(1)),
          oldHousing: parseFloat((25 + rng() * 30).toFixed(1)),
          crowding: parseFloat((tractPoverty * 0.4).toFixed(1)),
          noVehicle: parseFloat((tractPoverty * 0.8).toFixed(1)),
          transit: parseFloat((12 + rng() * 20).toFixed(1)),
          commute: parseFloat((24 + rng() * 12).toFixed(1)),
          noDiploma: parseFloat((tractPoverty * 0.6 + 2).toFixed(1)),
          bachelors: parseFloat(Math.max(10, 60 - tractPoverty * 1.5).toFixed(1)),
          broadband: parseFloat(Math.max(65, 96 - tractPoverty * 0.8).toFixed(1)),
          unemployment: parseFloat((tractPoverty * 0.35 + 2.5).toFixed(1)),
          lfp: parseFloat((65 + (rng() - 0.5) * 10).toFixed(1)),
          uninsured: parseFloat(tractUninsured.toFixed(1)),
          pcp: Math.round(Math.max(20, 160 - tractSvi * 80)),
          driveTime: Math.round(8 + tractSvi * 18),
          access: Math.round(Math.max(25, 95 - tractSvi * 50)),
          diabetes: parseFloat(tractDiabetes.toFixed(1)),
          hypertension: parseFloat((c.hypertension + (tractSvi - 0.5) * 14).toFixed(1)),
          asthma: parseFloat((c.asthma + (tractSvi - 0.5) * 6).toFixed(1)),
          obesity: parseFloat((c.obesity + (tractSvi - 0.5) * 12).toFixed(1)),
          copd: parseFloat((c.copd + (tractSvi - 0.5) * 4).toFixed(1)),
          lifeExp: parseFloat(tractLifeExp.toFixed(1)),
          utilization: parseFloat((countyUtil - (tractSvi - 0.5) * 20).toFixed(1))
        },
        prog: {
          wic: Math.round(Math.max(20, c.wic - (tractSvi - 0.5) * 25)),
          imm: Math.round(Math.max(30, c.imm - (tractSvi - 0.5) * 20)),
          dpp: Math.round(Math.max(15, c.dpp - (tractSvi - 0.5) * 30)),
          tob: Math.round(Math.max(10, c.tob - (tractSvi - 0.5) * 25)),
          mhv: Math.round(Math.max(15, c.mhv - (tractSvi - 0.5) * 20))
        },
        dataStatus: 'adequate',
        flagged: tier >= 3 && rng() > 0.6 // Some high-vulnerability tracts flagged by default
      });
    }
  }

  await CensusTract.insertMany(tracts);
  console.log(`[Seed] Inserted ${tracts.length} census tracts.`);

  // 4. Insert Initial Assessments (CHNA Projects)
  const assessments = [
    {
      _id: 'A-2041',
      title: 'South county chronic disease needs assessment',
      jurisdictionId: '53033',
      status: 'In review',
      step: 4,
      indicators: ['diabetes', 'hypertension', 'uninsured', 'poverty'],
      focusTracts: ['53033001001', '53033002001', '53033003001'],
      owner: 'Community Health Team',
      due: '2026-11-15',
      template: 'chronic'
    },
    {
      _id: 'A-2038',
      title: 'Maternal and child health access review',
      jurisdictionId: '53033',
      status: 'Draft',
      step: 2,
      indicators: ['childPoverty', 'prog.wic', 'prog.mhv'],
      focusTracts: ['53033004001'],
      owner: 'Program Manager',
      due: '2026-12-02',
      template: 'mch'
    },
    {
      _id: 'A-2027',
      title: 'Transportation barriers to primary care',
      jurisdictionId: '53033',
      status: 'Completed',
      step: 5,
      indicators: ['noVehicle', 'driveTime', 'pcp'],
      focusTracts: ['53033005001', '53033006001'],
      owner: 'Public Health Analyst',
      due: '2026-09-30',
      template: 'access'
    },
    {
      _id: 'A-2019',
      title: 'Asthma burden and housing conditions',
      jurisdictionId: '53033',
      status: 'Completed',
      step: 5,
      indicators: ['asthma', 'oldHousing', 'crowding'],
      focusTracts: ['53033007001'],
      owner: 'Community Health Team',
      due: '2026-08-15',
      template: 'custom'
    }
  ];

  await Assessment.insertMany(assessments);
  console.log(`[Seed] Inserted ${assessments.length} assessment projects.`);

  // 5. Insert Findings
  const findings = [
    {
      _id: 'F-init1',
      assessmentId: 'A-2041',
      tractId: '53033001001',
      tractName: 'Census Tract 10.01',
      countyLabel: 'King County, WA',
      note: 'High diabetes prevalence (14.2%) coupled with 18.5% uninsured rate. High-priority candidate for mobile screening van.',
      snapshot: { svi: 0.82, tier: 'High', poverty: 22.4, uninsured: 18.5, diabetes: 14.2, access: 42, lifeExp: 75.8 },
      addedDate: '2026-10-22'
    },
    {
      _id: 'F-init2',
      assessmentId: 'A-2041',
      tractId: '53033002001',
      tractName: 'Census Tract 20.01',
      countyLabel: 'King County, WA',
      note: 'Life expectancy gap of 6.2 years compared to northern county median. Elevated hypertension and poverty rates.',
      snapshot: { svi: 0.88, tier: 'Very high', poverty: 26.1, uninsured: 19.8, diabetes: 15.6, access: 38, lifeExp: 74.2 },
      addedDate: '2026-10-24'
    }
  ];

  await Finding.insertMany(findings);
  console.log(`[Seed] Inserted ${findings.length} findings.`);

  // 6. Insert Reports
  const reports = [
    {
      _id: 'R-118',
      title: 'Q3 community vulnerability brief',
      type: 'Vulnerability brief',
      fromAssessmentId: 'A-2027',
      jurisdictionId: '53033',
      primaryMetric: 'svi',
      status: 'Published',
      focusTracts: [
        { name: 'Census Tract 10.01', id: '53033001001', svi: 0.82, pop: 4800, uninsured: 18.5, metricValue: 0.82 },
        { name: 'Census Tract 20.01', id: '53033002001', svi: 0.88, pop: 5200, uninsured: 19.8, metricValue: 0.88 }
      ],
      findingsSnapshot: ['High transportation barrier with 24% of households lacking vehicle access.'],
      methodNote: 'Prepared for King County Board of Health using 2026 SVI composite index.'
    },
    {
      _id: 'R-114',
      title: 'Program utilization gap analysis',
      type: 'Program review',
      fromAssessmentId: null,
      jurisdictionId: '53033',
      primaryMetric: 'utilization',
      status: 'Published',
      focusTracts: [],
      findingsSnapshot: ['WIC gap of 22% observed in southern census tracts.'],
      methodNote: 'Derived from state program enrollment cross-tabulated with ACS income thresholds.'
    },
    {
      _id: 'R-121',
      title: 'South county chronic disease draft',
      type: 'Assessment summary',
      fromAssessmentId: 'A-2041',
      jurisdictionId: '53033',
      primaryMetric: 'diabetes',
      status: 'Draft',
      focusTracts: [],
      findingsSnapshot: [],
      methodNote: 'Draft summary awaiting senior epidemiologist sign-off.'
    }
  ];

  await Report.insertMany(reports);
  console.log(`[Seed] Inserted ${reports.length} reports.`);

  // 7. Insert Data Sources & Logs
  await DataSource.insertMany([
    {
      _id: 'census',
      name: 'Census Bureau API',
      icon: 'cloud',
      status: 'ok',
      desc: 'ACS 5-year estimates, decennial counts and TIGER/Line tract geometry',
      meta: [['Endpoints', 'ACS5, DEC, TIGERweb'], ['Tables synced', '38'], ['Geographies', 'Tract, county, state']],
      lastSync: new Date()
    },
    {
      _id: 'tiles',
      name: 'Vector tile service',
      icon: 'server',
      status: 'ok',
      desc: 'Spatially indexed tract and county layers served as vector tiles',
      meta: [['Layers', '12'], ['Index', 'Spatial GiST on geometry'], ['Simplification', '3 zoom tiers']],
      lastSync: new Date()
    },
    {
      _id: 'chronic',
      name: 'Chronic disease prevalence feed',
      icon: 'activity',
      status: 'warn',
      desc: 'Model-based tract prevalence estimates, uploaded quarterly',
      meta: [['Measures', '14'], ['Suppressed tracts', '312'], ['Cadence', 'Quarterly']],
      lastSync: new Date(Date.now() - 864e5 * 2)
    },
    {
      _id: 'programs',
      name: 'State program registry',
      icon: 'users',
      status: 'bad',
      desc: 'Enrollment extracts for WIC, immunization and home visiting programs',
      meta: [['Programs', '5'], ['Last good sync', '2026-10-17'], ['Issue', 'Credentials expired']],
      lastSync: new Date(Date.now() - 864e5 * 7)
    }
  ]);

  await ImportLog.insertMany([
    { _id: 'IMP-3391', name: 'ACS 5-year tract estimates', src: 'Census Bureau API', rows: 2841203, status: 'Completed', duration: '14m 02s', startedAt: new Date() },
    { _id: 'IMP-3388', name: 'Chronic disease prevalence (tract)', src: 'File upload', rows: 72337, status: 'Completed with warnings', duration: '1m 48s', startedAt: new Date(Date.now() - 864e5 * 2) },
    { _id: 'IMP-3384', name: 'Program enrollment extract', src: 'State program registry', rows: 18422, status: 'Failed', duration: '0m 31s', startedAt: new Date(Date.now() - 864e5 * 5) }
  ]);

  await ProcessingError.insertMany([
    { _id: 'E-551', dataset: 'State program enrollment extract', msg: '1,204 records reference retired 2010 census tract GEOIDs', severity: 'bad', open: true },
    { _id: 'E-548', dataset: 'CDC PLACES chronic disease feed', msg: 'Suppression threshold triggered for 48 tracts with population under 50', severity: 'warn', open: true }
  ]);

  // 8. Create Default Analyst UserSession
  await UserSession.create({
    _id: 'default-analyst',
    activeJurisdiction: '53033',
    activeLayer: 'sdoh',
    activeMetric: 'sdoh',
    compareTracts: ['53033001001', '53033002001'],
    flaggedTracts: ['53033001001'],
    theme: 'light',
    trendWindowYears: 10,
    workflowMilestones: { dash: true, map: true, region: true, tract: true }
  });

  console.log('[Seeding Complete] Successfully populated all collections.');
}

// Direct execution
if (process.argv[1]?.endsWith('seed.js')) {
  (async () => {
    try {
      await connectDB();
      await seedDatabase();
      await disconnectDB();
      process.exit(0);
    } catch (err) {
      console.error('[Seed Error]:', err);
      process.exit(1);
    }
  })();
}
