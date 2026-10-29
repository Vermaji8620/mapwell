import express from 'express';
import { Finding } from '../models/Finding.js';
import { Assessment } from '../models/Assessment.js';
import { CensusTract } from '../models/CensusTract.js';
import { Jurisdiction } from '../models/Jurisdiction.js';
import { TIER_LABELS } from '../config/metrics.js';
import { getMetricValue } from '../utils/mathAnalytics.js';

const router = express.Router();

/**
 * GET /api/findings
 * List findings, filterable by assessmentId or tractId
 */
router.get('/', async (req, res, next) => {
  try {
    const { assessmentId, tractId } = req.query;
    const filter = {};

    if (assessmentId) filter.assessmentId = assessmentId;
    if (tractId) filter.tractId = tractId;

    const findings = await Finding.find(filter)
      .sort({ createdAt: -1 })
      .lean();

    res.json(findings);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/findings
 * Create a new finding linked to an assessment and tract
 * Automatically captures an immutable snapshot of tract indicators
 */
router.post('/', async (req, res, next) => {
  try {
    const { assessmentId, tractId, note } = req.body;

    if (!assessmentId || !tractId || !note) {
      return res.status(400).json({ error: 'assessmentId, tractId, and note are required.' });
    }

    const [assessment, tract] = await Promise.all([
      Assessment.findById(assessmentId),
      CensusTract.findById(tractId).lean()
    ]);

    if (!assessment) {
      return res.status(404).json({ error: `Assessment '${assessmentId}' not found.` });
    }
    if (!tract) {
      return res.status(404).json({ error: `Census tract '${tractId}' not found.` });
    }

    const county = await Jurisdiction.findById(tract.countyFips).lean();
    const countyLabel = county ? `${county.name}, ${county.stateAbbr}` : tract.countyFips;

    const findingId = `F-${Date.now().toString(36)}`;

    // Snapshot of tract metrics at observation time
    const snapshot = {
      svi: tract.svi,
      tier: TIER_LABELS[tract.tier] || 'Moderate',
      poverty: getMetricValue(tract, 'poverty') || 0,
      uninsured: getMetricValue(tract, 'uninsured') || 0,
      diabetes: getMetricValue(tract, 'diabetes') || 0,
      access: getMetricValue(tract, 'access') || 50,
      lifeExp: getMetricValue(tract, 'lifeExp') || 78.5
    };

    const finding = await Finding.create({
      _id: findingId,
      assessmentId,
      tractId,
      tractName: tract.name,
      countyLabel,
      note,
      snapshot,
      addedDate: new Date().toISOString().slice(0, 10)
    });

    // Ensure tract is added to assessment focusTracts
    if (!assessment.focusTracts.includes(tractId)) {
      assessment.focusTracts.push(tractId);
      await assessment.save();
    }

    res.status(201).json(finding);
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/findings/:id
 * Delete a finding
 */
router.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const finding = await Finding.findByIdAndDelete(id);

    if (!finding) {
      return res.status(404).json({ error: `Finding '${id}' not found.` });
    }

    res.json({ message: `Finding '${id}' deleted successfully.` });
  } catch (err) {
    next(err);
  }
});

export default router;
