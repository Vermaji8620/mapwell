// server/src/utils/countyDataHelper.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let countiesCache = null;
let countyMap = null;

export function getAllCounties() {
  if (!countiesCache) {
    try {
      const dataPath = path.resolve(__dirname, '../data/counties_full.json');
      if (fs.existsSync(dataPath)) {
        const raw = fs.readFileSync(dataPath, 'utf8');
        countiesCache = JSON.parse(raw);
        countyMap = new Map();
        for (const c of countiesCache) {
          countyMap.set(String(c._id).padStart(5, '0'), c);
        }
      } else {
        countiesCache = [];
        countyMap = new Map();
      }
    } catch (err) {
      console.error('[CountyDataHelper Error]:', err);
      countiesCache = [];
      countyMap = new Map();
    }
  }
  return countiesCache;
}

export function getCountyFromFullDataset(fips) {
  if (!countyMap) {
    getAllCounties();
  }
  const cleanId = String(fips).padStart(5, '0');
  return countyMap.get(cleanId) || null;
}
