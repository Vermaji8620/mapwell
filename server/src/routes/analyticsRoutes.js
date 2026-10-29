import express from 'express';
import { CensusTract } from '../models/CensusTract.js';
import { Jurisdiction } from '../models/Jurisdiction.js';
import { METRICS } from '../config/metrics.js';
import { calculateDisparityAnalysis, simulateResourceAllocation, weightedMean, getMetricValue } from '../utils/mathAnalytics.js';

const router = express.Router();

/**
 * GET /api/analytics/disparities
 * Disparity analysis: quintiles, disparity ratio, concentration curve, and regional comparison
 */
router.get('/disparities', async (req, res, next) => {
  try {
    const { metric = 'diabetes', geo = 'state', county = '53033' } = req.query;

    let units = [];
    const activeCounty = await Jurisdiction.findById(county).lean();

    if (geo === 'tracts') {
      units = await CensusTract.find({ countyFips: county }).lean();
    } else if (geo === 'state' && activeCounty) {
      units = await Jurisdiction.find({ stateFips: activeCounty.stateFips }).lean();
    } else {
      // 'nation'
      units = await Jurisdiction.find({}).lean();
    }

    if (units.length === 0) {
      units = await Jurisdiction.find({}).lean();
    }

    const analysis = calculateDisparityAnalysis(units, metric);

    // Regional breakdown (Northeast, Midwest, South, West)
    const allCounties = await Jurisdiction.find({}).lean();
    const regions = ['Northeast', 'Midwest', 'South', 'West'];
    const regionalAverages = regions.map(r => {
      const regCounties = allCounties.filter(c => c.region === r);
      return {
        region: r,
        value: parseFloat(weightedMean(regCounties, metric).toFixed(2))
      };
    });

    res.json({
      ...analysis,
      scope: geo,
      regionalAverages
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/analytics/trends
 * 10-year historical trends for selected county vs state average vs national median
 */
router.get('/trends', async (req, res, next) => {
  try {
    const { metric = 'diabetes', county = '53033', range = '10' } = req.query;
    const numYears = Math.min(10, Math.max(3, parseInt(range, 10) || 10));

    const targetCounty = await Jurisdiction.findById(county).lean();
    if (!targetCounty) {
      return res.status(404).json({ error: `Jurisdiction with FIPS '${county}' not found.` });
    }

    const stateCounties = await Jurisdiction.find({ stateFips: targetCounty.stateFips }).lean();
    const allCounties = await Jurisdiction.find({}).lean();

    const countyVal = getMetricValue(targetCounty, metric) || 10;
    const stateVal = weightedMean(stateCounties, metric) || 10;
    const nationalVal = weightedMean(allCounties, metric) || 10;

    const baseYear = 2026 - numYears;
    const years = Array.from({ length: numYears }, (_, i) => String(baseYear + i));

    // Deterministic trend generator simulating 10-year public health surveillance
    function generateTrendSeries(endVal, slope = 0.012) {
      const series = [];
      for (let i = 0; i < numYears; i++) {
        const factor = 1 - (numYears - 1 - i) * slope;
        series.push(parseFloat((endVal * factor).toFixed(2)));
      }
      return series;
    }

    res.json({
      metric,
      years,
      series: [
        {
          name: targetCounty.name,
          color: '#2584EB',
          values: generateTrendSeries(countyVal, 0.015)
        },
        {
          name: `${targetCounty.stateName} Average`,
          color: '#5CCAD2',
          values: generateTrendSeries(stateVal, 0.009)
        },
        {
          name: 'National Median',
          color: '#8A94B8',
          dash: '4 4',
          values: generateTrendSeries(nationalVal, 0.006)
        }
      ]
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/analytics/resource-allocation
 * Simulation model for allocating outreach staff (FTEs) to highest-need coverage gap tracts
 */
router.get('/resource-allocation', async (req, res, next) => {
  try {
    const { county = '53033', program = 'all', fte = '6' } = req.query;
    const fteCount = Math.max(1, Math.min(20, parseInt(fte, 10) || 6));

    const tracts = await CensusTract.find({ countyFips: county }).lean();

    if (tracts.length === 0) {
      return res.status(404).json({ error: `No census tracts found for county '${county}'.` });
    }

    const simulation = simulateResourceAllocation(tracts, fteCount, program);

    res.json({
      county,
      ...simulation
    });
  } catch (err) {
    next(err);
  }
});

export default router;
