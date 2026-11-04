// server/src/utils/tractGenerator.js
// Deterministic tract generator matching prototype demo folder/entire_website.html lines 1113-1165

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1e6) / 1e6;
}

function rng(seed) {
  let s = Math.floor(seed * 2147483646) + 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

function gauss(r) {
  return Math.sqrt(-2 * Math.log(r() + 1e-9)) * Math.cos(2 * Math.PI * r());
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function generateTractsForCounty(c) {
  const cid = String(c._id || c.id).padStart(5, '0');
  const pop = c.population || (c.indicators && c.indicators.population) || 80000;
  const n = clamp(Math.round(Math.sqrt(pop) / 11), 6, 140);

  const ind = c.indicators || {};
  const cSvi = ind.svi !== undefined ? ind.svi : (c.svi || 0.4);
  const cPoverty = ind.poverty !== undefined ? ind.poverty : 12;
  const cUninsured = ind.uninsured !== undefined ? ind.uninsured : 8;
  const cDiabetes = ind.diabetes !== undefined ? ind.diabetes : 9;
  const cAsthma = ind.asthma !== undefined ? ind.asthma : 8.5;
  const cHypertension = ind.hypertension !== undefined ? ind.hypertension : 28;
  const cNoVehicle = ind.noVehicle !== undefined ? ind.noVehicle : 5;
  const cNoDiploma = ind.noDiploma !== undefined ? ind.noDiploma : 10;
  const cUnemployment = ind.unemployment !== undefined ? ind.unemployment : 5;
  const cUtilization = ind.utilization !== undefined ? ind.utilization : 50;
  const cAccess = ind.access !== undefined ? ind.access : 65;
  const cLifeExp = ind.lifeExp !== undefined ? ind.lifeExp : 78;
  const cChildPoverty = ind.childPoverty !== undefined ? ind.childPoverty : cPoverty * 1.3;
  const cIncome = ind.income !== undefined ? ind.income : 70000;
  const cRentBurden = ind.rentBurden !== undefined ? ind.rentBurden : 28;
  const cOldHousing = ind.oldHousing !== undefined ? ind.oldHousing : 25;
  const cCrowding = ind.crowding !== undefined ? ind.crowding : 3.5;
  const cTransit = ind.transit !== undefined ? ind.transit : 20;
  const cCommute = ind.commute !== undefined ? ind.commute : 25;
  const cBachelors = ind.bachelors !== undefined ? ind.bachelors : 35;
  const cBroadband = ind.broadband !== undefined ? ind.broadband : 85;
  const cLfp = ind.lfp !== undefined ? ind.lfp : 65;
  const cPcp = ind.pcp !== undefined ? ind.pcp : 100;
  const cDriveTime = ind.driveTime !== undefined ? ind.driveTime : 18;
  const cCopd = ind.copd !== undefined ? ind.copd : 5.5;
  const cObesity = ind.obesity !== undefined ? ind.obesity : 30;
  const cSdoh = ind.sdoh !== undefined ? ind.sdoh : 40;
  const cIncidence = ind.incidence !== undefined ? ind.incidence : 35;

  const tracts = [];
  for (let i = 0; i < n; i++) {
    const rr = rng(hash(cid + ':' + i));
    const ln = () => gauss(rr);
    const k = ln() * 0.12;

    const tnum = (100 + i * 2 + Math.floor(rr() * 2));
    const suffix = rr() < 0.35 ? '.0' + (1 + Math.floor(rr() * 2)) : '';
    const geoid = cid + String(tnum).padStart(4, '0') + (suffix ? suffix.slice(1).padStart(2, '0') : '00');

    const tractSvi = clamp(cSvi + k * 1.1 + ln() * 0.05, 0.01, 0.99);
    const tier = clamp(Math.floor(tractSvi * 5), 0, 4);

    const tractPop = Math.round(clamp(2400 + rr() * 4800, 1200, 8200));

    const tractIndicators = {
      svi: parseFloat(tractSvi.toFixed(2)),
      poverty: parseFloat(clamp(cPoverty * (1 + k * 2.2) + ln() * 2, 1.5, 58).toFixed(1)),
      uninsured: parseFloat(clamp(cUninsured * (1 + k * 2) + ln() * 1.5, 1, 40).toFixed(1)),
      diabetes: parseFloat(clamp(cDiabetes * (1 + k * 1.2) + ln() * 0.6, 3.5, 24).toFixed(1)),
      asthma: parseFloat(clamp(cAsthma * (1 + k * 0.7) + ln() * 0.4, 5.5, 17).toFixed(1)),
      hypertension: parseFloat(clamp(cHypertension * (1 + k * 0.8) + ln() * 1.4, 18, 55).toFixed(1)),
      noVehicle: parseFloat(clamp(cNoVehicle * (1 + k * 2) + ln() * 1.5, 0.3, 44).toFixed(1)),
      noDiploma: parseFloat(clamp(cNoDiploma * (1 + k * 1.8) + ln() * 1.5, 1, 45).toFixed(1)),
      unemployment: parseFloat(clamp(cUnemployment * (1 + k * 1.7) + ln() * 0.6, 1, 22).toFixed(1)),
      utilization: Math.round(clamp(cUtilization * (1 - k * 1.4) + ln() * 4, 4, 95)),
      access: Math.round(clamp(cAccess * (1 - k * 1.1) + ln() * 4, 4, 98)),
      lifeExp: parseFloat(clamp(cLifeExp - k * 9 + ln() * 0.7, 62, 88).toFixed(1)),
      childPoverty: parseFloat(clamp(cChildPoverty * (1 + k * 2) + ln() * 2, 2, 65).toFixed(1)),
      income: Math.round(Math.max(15000, cIncome * (1 - k * 0.8) + ln() * 4000)),
      rentBurden: parseFloat(clamp(cRentBurden * (1 + k * 1.4) + ln() * 2, 6, 68).toFixed(1)),
      oldHousing: parseFloat(clamp(cOldHousing + ln() * 4, 4, 75).toFixed(1)),
      crowding: parseFloat(clamp(cCrowding * (1 + k * 1.5) + ln() * 0.8, 0.2, 22).toFixed(1)),
      transit: parseFloat(clamp(cTransit + ln() * 5, 0, 95).toFixed(1)),
      commute: parseFloat(clamp(cCommute + ln() * 3, 10, 50).toFixed(1)),
      bachelors: parseFloat(clamp(cBachelors * (1 - k * 0.8) + ln() * 3, 5, 80).toFixed(1)),
      broadband: parseFloat(clamp(cBroadband * (1 - k * 0.5) + ln() * 3, 40, 99).toFixed(1)),
      lfp: parseFloat(clamp(cLfp + ln() * 3, 40, 85).toFixed(1)),
      pcp: Math.round(clamp(cPcp * (1 - k * 0.8) + ln() * 8, 10, 220)),
      driveTime: Math.round(clamp(cDriveTime * (1 + k * 0.9) + ln() * 3, 2, 80)),
      copd: parseFloat(clamp(cCopd * (1 + k * 0.8) + ln() * 0.6, 2, 20).toFixed(1)),
      obesity: parseFloat(clamp(cObesity * (1 + k * 0.7) + ln() * 1.5, 15, 55).toFixed(1)),
      sdoh: Math.round(clamp(cSdoh + k * 35 + ln() * 3, 2, 98)),
      incidence: Math.round(clamp(cIncidence + k * 30 + ln() * 3, 2, 98))
    };

    const cProg = c.prog || {};
    const tractProg = {
      wic: Math.round(clamp((cProg.wic || 65) * (1 - k * 1.3) + ln() * 4, 3, 97)),
      imm: Math.round(clamp((cProg.imm || 75) * (1 - k * 1.3) + ln() * 4, 3, 97)),
      dpp: Math.round(clamp((cProg.dpp || 40) * (1 - k * 1.3) + ln() * 4, 3, 97)),
      tob: Math.round(clamp((cProg.tob || 35) * (1 - k * 1.3) + ln() * 4, 3, 97)),
      mhv: Math.round(clamp((cProg.mhv || 45) * (1 - k * 1.3) + ln() * 4, 3, 97))
    };

    const centroid = Array.isArray(c.centroid) && c.centroid.length === 2
      ? [parseFloat((c.centroid[0] + (rr() - 0.5) * 0.1).toFixed(3)), parseFloat((c.centroid[1] + (rr() - 0.5) * 0.1).toFixed(3))]
      : [0, 0];

    tracts.push({
      _id: geoid,
      countyFips: cid,
      name: 'Census Tract ' + tnum + suffix,
      population: tractPop,
      svi: parseFloat(tractSvi.toFixed(2)),
      tier,
      centroid,
      indicators: tractIndicators,
      prog: tractProg,
      dataStatus: 'adequate',
      flagged: false
    });
  }

  // Normalize populations to county sum
  const sumPop = tracts.reduce((acc, t) => acc + t.population, 0);
  if (sumPop > 0) {
    tracts.forEach(t => {
      t.population = Math.max(50, Math.round((t.population / sumPop) * pop));
    });
  }

  return tracts;
}
