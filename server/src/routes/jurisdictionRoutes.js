import express from 'express';
import { Jurisdiction } from '../models/Jurisdiction.js';

const router = express.Router();

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

    const jurisdictions = await Jurisdiction.find(filter)
      .sort({ name: 1 })
      .lean();

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
    const county = await Jurisdiction.findById(id).lean();

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
