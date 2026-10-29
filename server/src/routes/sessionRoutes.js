import express from 'express';
import { UserSession } from '../models/UserSession.js';

const router = express.Router();

/**
 * GET /api/session
 * Retrieve the active analyst session
 */
router.get('/', async (req, res, next) => {
  try {
    let session = await UserSession.findById('default-analyst').lean();

    if (!session) {
      session = await UserSession.create({
        _id: 'default-analyst',
        activeJurisdiction: '53033',
        activeLayer: 'sdoh',
        activeMetric: 'sdoh',
        compareTracts: [],
        flaggedTracts: [],
        theme: 'light',
        trendWindowYears: 10,
        workflowMilestones: { dash: true, map: true }
      });
    }

    res.json(session);
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/session
 * Update session state (active jurisdiction, comparison tray, flagged tracts, theme)
 */
router.patch('/', async (req, res, next) => {
  try {
    const updates = req.body;

    // Enforce compare tray max 4 tracts limit
    if (updates.compareTracts && updates.compareTracts.length > 4) {
      updates.compareTracts = updates.compareTracts.slice(-4);
    }

    const session = await UserSession.findByIdAndUpdate('default-analyst', updates, {
      new: true,
      upsert: true,
      runValidators: true
    });

    res.json(session);
  } catch (err) {
    next(err);
  }
});

export default router;
