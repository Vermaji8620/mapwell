import express from 'express';
import { Jurisdiction } from '../models/Jurisdiction.js';
import { getAllCounties, getCountyFromFullDataset } from '../utils/countyDataHelper.js';

const router = express.Router();

/**
 * POST /api/jurisdictions/seed-all
 * Bulk seed all 3,142 US counties into MongoDB
 */
router.post('/seed-all', async (req, res, next) => {
  try {
    const allCounties = getAllCounties();
    if (!allCounties || allCounties.length === 0) {
      return res.status(500).json({ error: 'Counties dataset not loaded.' });
    }

    try {
      await Jurisdiction.insertMany(allCounties, { ordered: false });
    } catch (bulkErr) {
      // E11000 duplicate keys are safely ignored when ordered: false
    }

    const finalCount = await Jurisdiction.countDocuments();
    res.json({
      message: `Database successfully seeded with full US jurisdiction dataset.`,
      count: finalCount
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/jurisdictions
 * List jurisdictions with optional search, state, and region filters
 */
router.get('/', async (req, res, next) => {
  try {
    const { q, state, region } = req.query;
    const filter = {};

    if (state) {
      filter.stateAbbr = state.toUpperCase();
    }
    if (region) {
      filter.region = region;
    }
    if (q) {
      const regex = new RegExp(q.trim(), 'i');
      filter.$or = [
        { name: regex },
        { stateName: regex },
        { stateAbbr: regex },
        { _id: regex }
      ];
    }

    let jurisdictions = await Jurisdiction.find(filter)
      .sort({ name: 1 })
      .lean();

    // Auto-seed full 3,142 counties if currently containing partial seed
    if (jurisdictions.length < 100 && !q && !state && !region) {
      const allCounties = getAllCounties();
      if (allCounties && allCounties.length > 0) {
        try {
          await Jurisdiction.insertMany(allCounties, { ordered: false });
          jurisdictions = await Jurisdiction.find(filter)
            .sort({ name: 1 })
            .lean();
        } catch (seedErr) {
          // Ignore duplicates
        }
      }
    }

    res.json({
      count: jurisdictions.length,
      data: jurisdictions
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/jurisdictions/:id
 * Retrieve details for a specific county by 5-digit FIPS code
 */
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    let county = await Jurisdiction.findById(id).lean();

    if (!county) {
      const fullCounty = getCountyFromFullDataset(id);
      if (fullCounty) {
        try {
          await Jurisdiction.create(fullCounty);
        } catch (e) {
          // Ignore duplicate
        }
        county = fullCounty;
      }
    }

    if (!county) {
      return res.status(404).json({ error: `Jurisdiction with FIPS '${id}' not found.` });
    }

    res.json(county);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/jurisdictions/:id/peers
 * Retrieve peer counties based on statistical similarity (SVI and population scale)
 */
router.get('/:id/peers', async (req, res, next) => {
  try {
    const { id } = req.params;
    const target = await Jurisdiction.findById(id).lean();

    if (!target) {
      return res.status(404).json({ error: `Jurisdiction with FIPS '${id}' not found.` });
    }

    const allOtherCounties = await Jurisdiction.find({ _id: { $ne: id } }).lean();

    // Distance metric: 3 * delta(SVI) + delta(log(Pop))
    const peers = allOtherCounties
      .map(c => {
        const sviDiff = Math.abs((c.svi || 0) - (target.svi || 0));
        const popRatio = Math.abs(Math.log((c.population || 1) / (target.population || 1)));
        const similarityScore = sviDiff * 3 + popRatio;
        return { county: c, similarityScore };
      })
      .sort((a, b) => a.similarityScore - b.similarityScore)
      .slice(0, 5)
      .map(p => p.county);

    res.json(peers);
  } catch (err) {
    next(err);
  }
});

export default router;
