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

async function generateUniqueReportId() {
  let id;
  let exists = true;
  while (exists) {
    const num = Math.floor(130 + Math.random() * 870);
    id = `R-${num}`;
    exists = await Report.exists({ _id: id });
  }
  return id;
}

/**
 * POST /api/reports
 * Create a new report
 */
router.post('/', async (req, res, next) => {
  try {
    const { title, type = 'Vulnerability brief', fromAssessmentId, jurisdictionId = '53033', primaryMetric = 'svi' } = req.body;

    const id = await generateUniqueReportId();

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
    delete updates._id;

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

    const newId = await generateUniqueReportId();

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
 * Guarantees identical data schema, metric attributes, and total tract volume across all formats.
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
    const tracts = await CensusTract.find({ countyFips: report.jurisdictionId }).sort({ svi: -1 }).lean();
    const metric = METRICS[report.primaryMetric] || { short: report.primaryMetric, label: report.primaryMetric };

    // Helper to extract metric values safely
    const getVal = (t, key) => {
      if (!key) return 0;
      if (key.startsWith('prog.')) {
        const pk = key.replace('prog.', '');
        return t.prog?.[pk] ?? 50;
      }
      const val = t.indicators?.[key] ?? t[key] ?? t.svi;
      return typeof val === 'number' ? val : 0;
    };

    // Determine focus tracts cohort
    const focusIds = new Set((report.focusTracts || []).map(t => (typeof t === 'string' ? t : t.id || t._id)));
    const isTractFocus = (t) => (focusIds.size > 0 ? focusIds.has(t._id) : (t.tier ?? 0) >= 3);

    // Uniform enriched tract records for ALL formats
    const enrichedTracts = tracts.map(t => {
      const isFocus = isTractFocus(t);
      const primaryVal = getVal(t, report.primaryMetric);
      const povertyVal = getVal(t, 'poverty');
      const uninsuredVal = getVal(t, 'uninsured');
      const diabetesVal = getVal(t, 'diabetes');
      const tierVal = t.tier ?? (t.svi < 0.2 ? 0 : t.svi < 0.4 ? 1 : t.svi < 0.6 ? 2 : t.svi < 0.8 ? 3 : 4);

      return {
        geoid: t._id,
        name: t.name,
        county: county?.name || report.jurisdictionId,
        state: county?.stateAbbr || '',
        svi: Number(t.svi.toFixed(3)),
        tier: tierVal,
        primaryMetricKey: report.primaryMetric,
        primaryMetricLabel: metric.short || metric.label,
        primaryMetricValue: Number(primaryVal.toFixed(2)),
        povertyRate: Number(povertyVal.toFixed(1)),
        uninsuredRate: Number(uninsuredVal.toFixed(1)),
        diabetesRate: Number(diabetesVal.toFixed(1)),
        population: t.population || 4000,
        isFocusTract: isFocus,
        centroid: t.centroid || null
      };
    });

    const totalPop = enrichedTracts.reduce((acc, t) => acc + t.population, 0);
    const focusTractsCount = enrichedTracts.filter(t => t.isFocusTract).length;
    const findingsList = (report.findingsSnapshot || []).map(f => (typeof f === 'string' ? f : f.note || JSON.stringify(f)));

    // 1. CSV Format: All tracts with complete uniform columns
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${report._id}-${report.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.csv"`);

      const headers = 'GEOID,TractName,County,State,SVI,Tier,PrimaryMetricKey,PrimaryMetricLabel,PrimaryMetricValue,PovertyRate_Pct,UninsuredRate_Pct,DiabetesRate_Pct,Population,IsFocusTract\n';
      const rows = enrichedTracts.map(t =>
        `"${t.geoid}","${t.name}","${t.county}","${t.state}",${t.svi},${t.tier},"${t.primaryMetricKey}","${t.primaryMetricLabel}",${t.primaryMetricValue},${t.povertyRate},${t.uninsuredRate},${t.diabetesRate},${t.population},"${t.isFocusTract ? 'Yes' : 'No'}"`
      ).join('\n');

      return res.send(headers + rows);
    }

    // 2. Markdown Format: Complete dataset table of ALL tracts and findings
    if (format === 'md') {
      res.setHeader('Content-Type', 'text/markdown');
      res.setHeader('Content-Disposition', `attachment; filename="${report._id}-${report.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.md"`);

      const md = `# ${report.title}
**Report ID**: ${report._id}  
**Type**: ${report.type}  
**Jurisdiction**: ${county?.name || report.jurisdictionId}, ${county?.stateAbbr || ''} (FIPS: ${report.jurisdictionId})  
**Status**: ${report.status}  
**Primary Indicator**: ${metric.label}  
**Created Date**: ${new Date(report.createdAt || Date.now()).toISOString().slice(0, 10)}  

---

## Executive Summary
This report summarizes **${metric.label}** and vulnerability indicators across all **${enrichedTracts.length}** census tracts in **${county?.name || ''} County**. A total of **${focusTractsCount}** tracts have been prioritized as high-need focus areas.

### Summary Metrics
- **Total Census Tracts**: ${enrichedTracts.length}
- **Prioritized Focus Tracts**: ${focusTractsCount}
- **Total Population Analyzed**: ${totalPop.toLocaleString()}
- **County Benchmark ${metric.short || metric.label}**: ${(enrichedTracts.reduce((a, b) => a + b.primaryMetricValue, 0) / (enrichedTracts.length || 1)).toFixed(1)}

---

## Synthesized Field Findings
${findingsList.length > 0 ? findingsList.map(f => `- ${f}`).join('\n') : '*No qualitative findings recorded for this report.*'}

---

## Census Tracts Surveillance Dataset (${enrichedTracts.length} tracts)
| GEOID | Tract Name | SVI | Tier | ${metric.short || metric.label} | Poverty (%) | Uninsured (%) | Diabetes (%) | Population | Focus Area |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
${enrichedTracts.map(t => `| ${t.geoid} | ${t.name} | ${t.svi.toFixed(2)} | Tier ${t.tier} | ${t.primaryMetricValue.toFixed(1)} | ${t.povertyRate}% | ${t.uninsuredRate}% | ${t.diabetesRate}% | ${t.population.toLocaleString()} | ${t.isFocusTract ? '**Yes**' : 'No'} |`).join('\n')}

---
### Methodology & Governance Note
${report.methodNote || 'Census tract boundaries and indicators conform to US Census Bureau ACS 5-year estimates and CDC PLACES small-area estimation modeling. Compiled by MapWell Community Health Surveillance System.'}
`;
      return res.send(md);
    }

    // 3. HTML Format: Standalone styled document with full table of ALL tracts
    if (format === 'html') {
      res.setHeader('Content-Type', 'text/html');
      res.setHeader('Content-Disposition', `attachment; filename="${report._id}-${report.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.html"`);

      const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${report.title} - ${report._id}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; max-width: 1080px; margin: 40px auto; padding: 0 24px; color: #0B1438; background: #FAFCFF; line-height: 1.5; }
    .header-bar { border-bottom: 2px solid #E3E9F8; padding-bottom: 16px; margin-bottom: 24px; }
    .badge { display: inline-block; padding: 4px 10px; border-radius: 99px; background: #EEF2FB; color: #0090C2; font-size: 11px; font-weight: 700; text-transform: uppercase; margin-bottom: 8px; }
    h1 { color: #0B1438; font-size: 28px; margin: 4px 0 8px; }
    .meta-line { font-size: 13px; color: #56628A; }
    .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin: 24px 0; }
    .metric-card { background: #FFFFFF; border: 1px solid #E3E9F8; border-radius: 12px; padding: 16px; box-shadow: 0 2px 8px rgba(20,40,120,0.04); }
    .metric-card small { display: block; color: #8A94B8; font-size: 11px; font-weight: 600; text-transform: uppercase; margin-bottom: 4px; }
    .metric-card strong { font-size: 22px; color: #0B1438; font-variant-numeric: tabular-nums; }
    .findings-box { background: #EEF2FB; border-left: 4px solid #0090C2; border-radius: 8px; padding: 16px; margin: 24px 0; font-size: 13px; }
    .findings-box ul { margin: 8px 0 0 18px; padding: 0; }
    table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 12.5px; background: #FFFFFF; border: 1px solid #E3E9F8; border-radius: 12px; overflow: hidden; }
    th, td { border-bottom: 1px solid #E3E9F8; padding: 10px 12px; text-align: left; }
    th { background: #EEF2FB; color: #56628A; font-size: 11px; font-weight: 700; text-transform: uppercase; }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
    .focus-yes { color: #E0336A; font-weight: 700; }
    .footer-note { margin-top: 36px; padding-top: 16px; border-top: 1px solid #E3E9F8; font-size: 11.5px; color: #8A94B8; }
  </style>
</head>
<body>
  <div class="header-bar">
    <span class="badge">${report.type} • ${report.status}</span>
    <h1>${report.title}</h1>
    <div class="meta-line">
      <strong>Report ID:</strong> ${report._id} &nbsp;|&nbsp; 
      <strong>Jurisdiction:</strong> ${county?.name || report.jurisdictionId} County, ${county?.stateAbbr || ''} (FIPS: ${report.jurisdictionId}) &nbsp;|&nbsp; 
      <strong>Primary Indicator:</strong> ${metric.label}
    </div>
  </div>

  <div class="summary-grid">
    <div class="metric-card">
      <small>Total Tracts</small>
      <strong>${enrichedTracts.length}</strong>
    </div>
    <div class="metric-card">
      <small>Focus Tracts</small>
      <strong style="color: #0090C2;">${focusTractsCount}</strong>
    </div>
    <div class="metric-card">
      <small>Population</small>
      <strong>${totalPop.toLocaleString()}</strong>
    </div>
    <div class="metric-card">
      <small>County ${metric.short || metric.label}</small>
      <strong>${(enrichedTracts.reduce((a, b) => a + b.primaryMetricValue, 0) / (enrichedTracts.length || 1)).toFixed(1)}%</strong>
    </div>
  </div>

  ${findingsList.length > 0 ? `
  <div class="findings-box">
    <strong>Synthesized Field Observations (${findingsList.length}):</strong>
    <ul>
      ${findingsList.map(f => `<li>${f}</li>`).join('')}
    </ul>
  </div>` : ''}

  <h2>Census Tract Surveillance Data (${enrichedTracts.length} tracts)</h2>
  <table>
    <thead>
      <tr>
        <th>GEOID</th>
        <th>Tract Name</th>
        <th class="num">SVI</th>
        <th>Tier</th>
        <th class="num">${metric.short || metric.label}</th>
        <th class="num">Poverty</th>
        <th class="num">Uninsured</th>
        <th class="num">Diabetes</th>
        <th class="num">Population</th>
        <th>Focus Area</th>
      </tr>
    </thead>
    <tbody>
      ${enrichedTracts.map(t => `
        <tr>
          <td><code>${t.geoid}</code></td>
          <td><strong>${t.name}</strong></td>
          <td class="num">${t.svi.toFixed(2)}</td>
          <td>Tier ${t.tier}</td>
          <td class="num">${t.primaryMetricValue.toFixed(1)}%</td>
          <td class="num">${t.povertyRate}%</td>
          <td class="num">${t.uninsuredRate}%</td>
          <td class="num">${t.diabetesRate}%</td>
          <td class="num">${t.population.toLocaleString()}</td>
          <td><span class="${t.isFocusTract ? 'focus-yes' : ''}">${t.isFocusTract ? 'Yes' : 'No'}</span></td>
        </tr>
      `).join('')}
    </tbody>
  </table>

  <div class="footer-note">
    <p><strong>Data Governance:</strong> ${report.methodNote || 'Census tract boundaries and indicators conform to US Census Bureau ACS 5-year estimates and CDC PLACES small-area estimation modeling.'}</p>
    <p>© ${new Date().getFullYear()} MapWell Community Health Mapping Platform. All rights reserved.</p>
  </div>
</body>
</html>`;
      return res.send(html);
    }

    // 4. JSON / GeoJSON FeatureCollection Format: Complete dataset of ALL tracts
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${report._id}-${report.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json"`);

    return res.json({
      type: 'FeatureCollection',
      reportId: report._id,
      title: report.title,
      reportType: report.type,
      status: report.status,
      jurisdiction: `${county?.name || ''}, ${county?.stateAbbr || ''}`,
      jurisdictionId: report.jurisdictionId,
      primaryMetric: {
        key: report.primaryMetric,
        label: metric.label,
        short: metric.short
      },
      totalTractsCount: enrichedTracts.length,
      focusTractsCount,
      totalPopulation: totalPop,
      findings: findingsList,
      methodNote: report.methodNote,
      features: enrichedTracts.map(t => ({
        type: 'Feature',
        id: t.geoid,
        properties: {
          geoid: t.geoid,
          name: t.name,
          county: t.county,
          state: t.state,
          svi: t.svi,
          tier: t.tier,
          [t.primaryMetricKey]: t.primaryMetricValue,
          povertyRate: t.povertyRate,
          uninsuredRate: t.uninsuredRate,
          diabetesRate: t.diabetesRate,
          population: t.population,
          isFocusTract: t.isFocusTract
        },
        geometry: t.centroid ? { type: 'Point', coordinates: t.centroid } : null
      }))
    });
  } catch (err) {
    next(err);
  }
});

export default router;
