import express from 'express';
import { Report } from '../models/Report.js';
import { Jurisdiction } from '../models/Jurisdiction.js';
import { CensusTract } from '../models/CensusTract.js';
import { METRICS } from '../config/metrics.js';

const router = express.Router();

/**
 * GET /api/reports
 * List reports with optional search and type/status filters
 */
router.get('/', async (req, res, next) => {
  try {
    const { q, type, status, jurisdiction } = req.query;
    const filter = {};

    if (type && type !== 'All') filter.type = type;
    if (status && status !== 'All') filter.status = status;
    if (jurisdiction) filter.jurisdictionId = jurisdiction;
    if (q) {
      const regex = new RegExp(q.trim(), 'i');
      filter.$or = [{ title: regex }, { _id: regex }];
    }

    const reports = await Report.find(filter)
      .sort({ createdAt: -1 })
      .lean();

    res.json(reports);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/reports/:id
 * Retrieve single report details
 */
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const report = await Report.findById(id).lean();

    if (!report) {
      return res.status(404).json({ error: `Report '${id}' not found.` });
    }

    const county = await Jurisdiction.findById(report.jurisdictionId).lean();

    res.json({
      ...report,
      county
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/reports
 * Create a new report
 */
router.post('/', async (req, res, next) => {
  try {
    const { title, type = 'Vulnerability brief', fromAssessmentId, jurisdictionId = '53033', primaryMetric = 'svi' } = req.body;

    const count = await Report.countDocuments();
    const id = `R-${125 + count + Math.floor(Math.random() * 30)}`;

    const report = await Report.create({
      _id: id,
      title: title || 'Untitled Report',
      type,
      fromAssessmentId: fromAssessmentId || null,
      jurisdictionId,
      primaryMetric,
      status: 'Draft'
    });

    res.status(201).json(report);
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/reports/:id
 * Update report (e.g. publish or title change)
 */
router.patch('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const report = await Report.findByIdAndUpdate(id, updates, { new: true });
    if (!report) {
      return res.status(404).json({ error: `Report '${id}' not found.` });
    }

    res.json(report);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/reports/:id/duplicate
 * Duplicate a report
 */
router.post('/:id/duplicate', async (req, res, next) => {
  try {
    const { id } = req.params;
    const original = await Report.findById(id).lean();

    if (!original) {
      return res.status(404).json({ error: `Report '${id}' not found.` });
    }

    const count = await Report.countDocuments();
    const newId = `R-${130 + count + Math.floor(Math.random() * 30)}`;

    delete original._id;
    delete original.createdAt;
    delete original.updatedAt;

    const duplicate = await Report.create({
      ...original,
      _id: newId,
      title: `${original.title} (Copy)`,
      status: 'Draft'
    });

    res.status(201).json(duplicate);
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/reports/:id
 * Delete a report
 */
router.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const report = await Report.findByIdAndDelete(id);

    if (!report) {
      return res.status(404).json({ error: `Report '${id}' not found.` });
    }

    res.json({ message: `Report '${id}' deleted successfully.` });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/reports/:id/export
 * Multi-format report exporter: html, csv, json, or md
 */
router.get('/:id/export', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { format = 'json' } = req.query;

    const report = await Report.findById(id).lean();
    if (!report) {
      return res.status(404).json({ error: `Report '${id}' not found.` });
    }

    const county = await Jurisdiction.findById(report.jurisdictionId).lean();
    const tracts = await CensusTract.find({ countyFips: report.jurisdictionId }).lean();
    const metric = METRICS[report.primaryMetric] || { short: report.primaryMetric, label: report.primaryMetric };

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${report._id}-export.csv"`);

      const headers = 'GEOID,TractName,County,SVI,Tier,PovertyRate,UninsuredRate,DiabetesRate,Population\n';
      const rows = tracts.map(t =>
        `"${t._id}","${t.name}","${county?.name || ''}",${t.svi},${t.tier},${t.indicators?.poverty || ''},${t.indicators?.uninsured || ''},${t.indicators?.diabetes || ''},${t.population}`
      ).join('\n');

      return res.send(headers + rows);
    }

    if (format === 'md') {
      res.setHeader('Content-Type', 'text/markdown');
      res.setHeader('Content-Disposition', `attachment; filename="${report._id}-export.md"`);

      const md = `# ${report.title}
**Report ID**: ${report._id}  
**Jurisdiction**: ${county?.name || report.jurisdictionId}, ${county?.stateAbbr || ''}  
**Type**: ${report.type}  
**Primary Indicator**: ${metric.label}  

## Executive Summary
This report summarizes community health indicators across ${tracts.length} census tracts.

## Focus Tracts
| GEOID | Tract Name | SVI | Population |
| :--- | :--- | :--- | :--- |
${tracts.slice(0, 10).map(t => `| ${t._id} | ${t.name} | ${t.svi} | ${t.population.toLocaleString()} |`).join('\n')}

## Findings
${(report.findingsSnapshot || []).map(f => `- ${f}`).join('\n') || 'No findings recorded.'}

---
*Generated by MapWell Geospatial Health Platform*
`;
      return res.send(md);
    }

    if (format === 'html') {
      res.setHeader('Content-Type', 'text/html');
      res.setHeader('Content-Disposition', `attachment; filename="${report._id}-export.html"`);

      const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${report.title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 900px; margin: 40px auto; padding: 0 20px; color: #0B1438; }
    h1 { color: #0090C2; }
    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
    th, td { border: 1px solid #E3E9F8; padding: 8px 12px; text-align: left; }
    th { background: #EEF2FB; }
    .badge { display: inline-block; padding: 4px 10px; border-radius: 99px; background: #EEF2FB; color: #56628A; font-size: 12px; }
  </style>
</head>
<body>
  <span class="badge">${report.type}</span>
  <h1>${report.title}</h1>
  <p><strong>Jurisdiction:</strong> ${county?.name || ''}, ${county?.stateAbbr || ''} (FIPS: ${report.jurisdictionId})</p>
  <p><strong>Method Note:</strong> ${report.methodNote}</p>
  <h2>Tract Overview (${tracts.length} tracts)</h2>
  <table>
    <thead><tr><th>GEOID</th><th>Tract</th><th>SVI</th><th>Population</th></tr></thead>
    <tbody>
      ${tracts.slice(0, 15).map(t => `<tr><td>${t._id}</td><td>${t.name}</td><td>${t.svi}</td><td>${t.population.toLocaleString()}</td></tr>`).join('')}
    </tbody>
  </table>
</body>
</html>`;
      return res.send(html);
    }

    // Default: JSON
    res.json({
      report,
      county,
      tractsCount: tracts.length,
      focusTracts: tracts.slice(0, 15)
    });
  } catch (err) {
    next(err);
  }
});

export default router;
