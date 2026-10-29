import express from 'express';
import { Assessment } from '../models/Assessment.js';
import { Finding } from '../models/Finding.js';
import { CensusTract } from '../models/CensusTract.js';
import { Report } from '../models/Report.js';

const router = express.Router();

/**
 * GET /api/assessments
 * List assessments with findings count
 */
router.get('/', async (req, res, next) => {
  try {
    const { status, jurisdiction } = req.query;
    const filter = {};

    if (status && status !== 'All') {
      filter.status = status;
    }
    if (jurisdiction) {
      filter.jurisdictionId = jurisdiction;
    }

    const assessments = await Assessment.find(filter)
      .sort({ updatedAt: -1 })
      .lean();

    // Attach finding count to each assessment
    const assessmentIds = assessments.map(a => a._id);
    const findings = await Finding.find({ assessmentId: { $in: assessmentIds } }).lean();

    const findingCountMap = {};
    for (const f of findings) {
      findingCountMap[f.assessmentId] = (findingCountMap[f.assessmentId] || 0) + 1;
    }

    const result = assessments.map(a => ({
      ...a,
      findingsCount: findingCountMap[a._id] || 0
    }));

    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/assessments/:id
 * Retrieve specific assessment with all attached findings and focus tracts
 */
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const assessment = await Assessment.findById(id).lean();

    if (!assessment) {
      return res.status(404).json({ error: `Assessment '${id}' not found.` });
    }

    const [findings, focusTracts] = await Promise.all([
      Finding.find({ assessmentId: id }).sort({ createdAt: -1 }).lean(),
      CensusTract.find({ _id: { $in: assessment.focusTracts || [] } }).lean()
    ]);

    res.json({
      ...assessment,
      findings,
      focusTractsDetails: focusTracts
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/assessments
 * Create a new draft assessment project
 */
router.post('/', async (req, res, next) => {
  try {
    const { title, jurisdictionId = '53033', template = 'custom', due, indicators } = req.body;

    const count = await Assessment.countDocuments();
    const id = `A-${2042 + count + Math.floor(Math.random() * 50)}`;

    const templateIndicators = {
      chronic: ['diabetes', 'hypertension', 'obesity', 'uninsured', 'poverty'],
      mch: ['childPoverty', 'prog.wic', 'prog.mhv', 'prog.imm', 'uninsured'],
      access: ['uninsured', 'pcp', 'driveTime', 'noVehicle'],
      custom: indicators || ['svi', 'poverty', 'uninsured', 'diabetes']
    };

    const newAssessment = await Assessment.create({
      _id: id,
      title: title || `Community Needs Assessment - ${jurisdictionId}`,
      jurisdictionId,
      status: 'Draft',
      step: 1,
      template,
      indicators: templateIndicators[template] || templateIndicators.custom,
      due: due || new Date(Date.now() + 45 * 864e5).toISOString().slice(0, 10),
      owner: 'Public Health Analyst',
      focusTracts: []
    });

    res.status(201).json(newAssessment);
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/assessments/:id
 * Update fields on an assessment (stepper advance, title, status, focus tracts)
 */
router.patch('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const assessment = await Assessment.findByIdAndUpdate(id, updates, {
      new: true,
      runValidators: true
    });

    if (!assessment) {
      return res.status(404).json({ error: `Assessment '${id}' not found.` });
    }

    res.json(assessment);
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/assessments/:id
 * Delete assessment and optionally associated findings
 */
router.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { cascade = 'true' } = req.query;

    const assessment = await Assessment.findByIdAndDelete(id);
    if (!assessment) {
      return res.status(404).json({ error: `Assessment '${id}' not found.` });
    }

    if (cascade === 'true') {
      await Finding.deleteMany({ assessmentId: id });
    }

    res.json({ message: `Assessment '${id}' deleted successfully.` });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/assessments/:id/compile
 * Compiles an assessment into a formal published or draft Report document
 */
router.post('/:id/compile', async (req, res, next) => {
  try {
    const { id } = req.params;
    const assessment = await Assessment.findById(id);

    if (!assessment) {
      return res.status(404).json({ error: `Assessment '${id}' not found.` });
    }

    const [findings, focusTracts] = await Promise.all([
      Finding.find({ assessmentId: id }).lean(),
      CensusTract.find({ _id: { $in: assessment.focusTracts || [] } }).lean()
    ]);

    const reportCount = await Report.countDocuments();
    const reportId = `R-${125 + reportCount + Math.floor(Math.random() * 20)}`;

    const report = await Report.create({
      _id: reportId,
      title: `${assessment.title} - Executive Summary`,
      type: 'Assessment summary',
      fromAssessmentId: assessment._id,
      jurisdictionId: assessment.jurisdictionId,
      primaryMetric: assessment.indicators[0] || 'svi',
      status: 'Draft',
      focusTracts: focusTracts.map(t => ({
        id: t._id,
        name: t.name,
        svi: t.svi,
        pop: t.population,
        uninsured: t.indicators?.uninsured || 0,
        diabetes: t.indicators?.diabetes || 0
      })),
      findingsSnapshot: findings.map(f => f.note),
      methodNote: `Compiled from Community Needs Assessment ${assessment._id}. Contains ${findings.length} field observations across ${focusTracts.length} focus tracts.`
    });

    // Mark assessment as completed
    assessment.status = 'Completed';
    assessment.step = 5;
    await assessment.save();

    res.status(201).json({
      message: 'Assessment compiled into report successfully.',
      reportId: report._id,
      report
    });
  } catch (err) {
    next(err);
  }
});

export default router;
