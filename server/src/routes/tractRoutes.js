import express from 'express';
import { CensusTract } from '../models/CensusTract.js';
import { Jurisdiction } from '../models/Jurisdiction.js';
import { METRICS } from '../config/metrics.js';
import { getMetricValue } from '../utils/mathAnalytics.js';
import { generateTractsForCounty } from '../utils/tractGenerator.js';
import { getCountyFromFullDataset } from '../utils/countyDataHelper.js';

const router = express.Router();

/**
 * GET /api/tracts
 * Retrieve census tracts for a county with tier and search filtering
 */
router.get('/', async (req, res, next) => {
  try {
    const { county, tier, q, flagged } = req.query;
    const filter = {};

    if (county) {
      filter.countyFips = county;
    }

    if (tier) {
      // Supports comma-separated tiers e.g. tier=3,4
      const tiers = tier.split(',').map(t => parseInt(t.trim(), 10)).filter(t => !isNaN(t));
      if (tiers.length > 0) {
        filter.tier = { $in: tiers };
      }
    }

    if (flagged === 'true') {
      filter.flagged = true;
    }

    if (q) {
      const regex = new RegExp(q.trim(), 'i');
      filter.$or = [
        { name: regex },
        { _id: regex }
      ];
    }

    let tracts = await CensusTract.find(filter)
      .sort({ svi: -1 })
      .lean();

    // Auto-generate and persist to database if county is queried but has 0 tracts in MongoDB
    if (county && tracts.length === 0) {
      let countyDoc = await Jurisdiction.findById(county).lean();
      if (!countyDoc) {
        countyDoc = getCountyFromFullDataset(county);
        if (countyDoc) {
          try {
            await Jurisdiction.create(countyDoc);
          } catch (err) {
            // Ignore if race condition
          }
        }
      }

      if (countyDoc) {
        const generated = generateTractsForCounty(countyDoc);
        if (generated.length > 0) {
          try {
            await CensusTract.insertMany(generated, { ordered: false });
          } catch (err) {
            // Ignore duplicate key warnings
          }
          // Re-query with original filter
          tracts = await CensusTract.find(filter)
            .sort({ svi: -1 })
            .lean();
        }
      }
    }

    res.json({
      count: tracts.length,
      data: tracts
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Multi-tract side-by-side comparison handler (GET & POST)
 * Supports query params ?ids=id1,id2 and body { tractIds: [...] }
 */
const handleCompare = async (req, res, next) => {
  try {
    let tractIds = req.body?.tractIds;
    if (!tractIds && req.query.ids) {
      tractIds = String(req.query.ids).split(',').map(s => s.trim()).filter(Boolean);
    }
    if (!tractIds && req.query.tractIds) {
      tractIds = Array.isArray(req.query.tractIds) ? req.query.tractIds : String(req.query.tractIds).split(',').map(s => s.trim()).filter(Boolean);
    }

    if (!Array.isArray(tractIds) || tractIds.length === 0) {
      return res.json({ tracts: [], lifeExpGap: null, matrix: [] });
    }

    // Limit to max 4
    const queryIds = tractIds.slice(0, 4);
    let tracts = await CensusTract.find({ _id: { $in: queryIds } }).lean();

    // Auto-generate missing tracts if requested by ID
    if (tracts.length < queryIds.length) {
      const missingIds = queryIds.filter(id => !tracts.some(t => t._id === id));
      const missingCounties = [...new Set(missingIds.map(id => id.slice(0, 5)))];
      for (const cid of missingCounties) {
        let countyDoc = await Jurisdiction.findById(cid).lean() || getCountyFromFullDataset(cid);
        if (countyDoc) {
          const gen = generateTractsForCounty(countyDoc);
          try {
            await CensusTract.insertMany(gen, { ordered: false });
          } catch (e) {}
        }
      }
      tracts = await CensusTract.find({ _id: { $in: queryIds } }).lean();
    }

    if (tracts.length < 2) {
      return res.json({ tracts, lifeExpGap: null, matrix: [] });
    }

    // Life Expectancy Gap calculation
    const lifeExpectancies = tracts
      .map(t => ({ tract: t, val: getMetricValue(t, 'lifeExp') }))
      .filter(x => x.val != null);

    let lifeExpGap = null;
    if (lifeExpectancies.length >= 2) {
      lifeExpectancies.sort((a, b) => b.val - a.val);
      const highest = lifeExpectancies[0];
      const lowest = lifeExpectancies[lifeExpectancies.length - 1];
      lifeExpGap = {
        gapYears: parseFloat((highest.val - lowest.val).toFixed(1)),
        highestLifeExpTract: { id: highest.tract._id, name: highest.tract.name, value: highest.val },
        lowestLifeExpTract: { id: lowest.tract._id, name: lowest.tract.name, value: lowest.val }
      };
    }

    // Core indicators comparison matrix
    const comparisonMetrics = ['poverty', 'uninsured', 'noVehicle', 'diabetes', 'asthma', 'unemployment'];
    const matrix = comparisonMetrics.map(key => {
      const meta = METRICS[key] || { short: key };
      return {
        metricKey: key,
        metricLabel: meta.short,
        values: tracts.map(t => ({
          tractId: t._id,
          tractName: t.name,
          value: getMetricValue(t, key)
        }))
      };
    });

    res.json({
      tracts,
      lifeExpGap,
      matrix
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Route: /api/tracts/compare
 * MUST come before /:geoid to avoid param collision
 */
router.get('/compare', handleCompare);
router.post('/compare', handleCompare);

/**
 * GET /api/tracts/:geoid
 * Retrieve single tract details with county baseline comparisons
 */
router.get('/:geoid', async (req, res, next) => {
  try {
    const { geoid } = req.params;
    let tract = await CensusTract.findById(geoid).lean();

    if (!tract && geoid && geoid.length === 11) {
      const cid = geoid.slice(0, 5);
      let countyDoc = await Jurisdiction.findById(cid).lean() || getCountyFromFullDataset(cid);
      if (countyDoc) {
        const gen = generateTractsForCounty(countyDoc);
        try {
          await CensusTract.insertMany(gen, { ordered: false });
        } catch (e) {}
        tract = await CensusTract.findById(geoid).lean();
      }
    }

    if (!tract) {
      return res.status(404).json({ error: `Census tract '${geoid}' not found.` });
    }

    const county = await Jurisdiction.findById(tract.countyFips).lean();

    // Attach indicator comparison against county
    const comparison = {};
    const coreMetrics = ['svi', 'poverty', 'uninsured', 'noVehicle', 'noDiploma', 'diabetes', 'asthma', 'lifeExp', 'access'];
    
    for (const key of coreMetrics) {
      const meta = METRICS[key] || { bad: 'high' };
      const tractVal = getMetricValue(tract, key);
      const countyVal = county ? getMetricValue(county, key) : null;
      const isWorse = meta.bad === 'low' ? tractVal < countyVal : tractVal > countyVal;

      comparison[key] = {
        tractValue: tractVal,
        countyValue: countyVal,
        isWorse
      };
    }

    res.json({
      ...tract,
      county,
      comparison
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/tracts/:geoid/flag
 * Toggle or set the flagged status of a tract
 */
router.patch('/:geoid/flag', async (req, res, next) => {
  try {
    const { geoid } = req.params;
    const { flagged } = req.body;

    const tract = await CensusTract.findById(geoid);
    if (!tract) {
      return res.status(404).json({ error: `Census tract '${geoid}' not found.` });
    }

    tract.flagged = flagged !== undefined ? Boolean(flagged) : !tract.flagged;
    await tract.save();

    res.json({
      geoid: tract._id,
      flagged: tract.flagged,
      message: tract.flagged ? 'Tract flagged as underserved' : 'Tract flag cleared'
    });
  } catch (err) {
    next(err);
  }
});

export default router;
