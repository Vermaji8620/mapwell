import http from 'http';

function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: 'localhost',
        port: 5000,
        path,
        method: options.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(options.headers || {})
        }
      },
      res => {
        let body = '';
        res.on('data', chunk => (body += chunk));
        res.on('end', () => {
          try {
            resolve({
              statusCode: res.statusCode,
              headers: res.headers,
              body: res.headers['content-type']?.includes('application/json')
                ? JSON.parse(body)
                : body
            });
          } catch {
            resolve({ statusCode: res.statusCode, body });
          }
        });
      }
    );
    req.on('error', reject);
    if (options.body) {
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }
    req.end();
  });
}

async function runTests() {
  console.log('[Test Suite] Validating MapWell API Endpoints...');
  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`  ✓ PASS: ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ FAIL: ${name} -`, err.message);
      failed++;
    }
  }

  // 1. Health Endpoint
  await test('GET /api/health', async () => {
    const res = await request('/api/health');
    if (res.statusCode !== 200 || res.body.status !== 'ok') {
      throw new Error(`Expected status 200 with ok, got ${res.statusCode}`);
    }
  });

  // 2. Jurisdictions List
  await test('GET /api/jurisdictions', async () => {
    const res = await request('/api/jurisdictions');
    if (res.statusCode !== 200 || !Array.isArray(res.body.data) || res.body.data.length === 0) {
      throw new Error(`Expected array of jurisdictions, got ${res.statusCode}`);
    }
  });

  // 3. County Detail & Peer Counties
  await test('GET /api/jurisdictions/53033 and /peers', async () => {
    const countyRes = await request('/api/jurisdictions/53033');
    if (countyRes.statusCode !== 200 || countyRes.body.name !== 'King County') {
      throw new Error(`Expected King County, got ${countyRes.body.name}`);
    }
    const peerRes = await request('/api/jurisdictions/53033/peers');
    if (peerRes.statusCode !== 200 || !Array.isArray(peerRes.body) || peerRes.body.length !== 5) {
      throw new Error(`Expected 5 peer counties, got ${peerRes.body.length}`);
    }
  });

  // 4. Census Tracts Retrieval
  await test('GET /api/tracts?county=53033', async () => {
    const res = await request('/api/tracts?county=53033');
    if (res.statusCode !== 200 || res.body.count === 0) {
      throw new Error(`Expected tracts for county 53033, got ${res.body.count}`);
    }
    const firstTract = res.body.data[0];
    if (!firstTract._id.startsWith('53033') || firstTract._id.length !== 11) {
      throw new Error(`Invalid 11-digit GEOID format: ${firstTract._id}`);
    }
  });

  // 5. Multi-Tract Comparison
  await test('POST /api/tracts/compare', async () => {
    const res = await request('/api/tracts/compare', {
      method: 'POST',
      body: { tractIds: ['53033001001', '53033002001'] }
    });
    if (res.statusCode !== 200 || !res.body.lifeExpGap) {
      throw new Error(`Expected life expectancy gap analysis in comparison, got status ${res.statusCode}`);
    }
  });

  // 6. Analytics: Disparities
  await test('GET /api/analytics/disparities?metric=diabetes&county=53033', async () => {
    const res = await request('/api/analytics/disparities?metric=diabetes&county=53033');
    if (res.statusCode !== 200 || !res.body.quintiles || res.body.quintiles.length !== 5) {
      throw new Error('Expected 5 quintile distribution values');
    }
    if (typeof res.body.disparityRatio !== 'number') {
      throw new Error('Expected numerical disparity ratio');
    }
  });

  // 7. Analytics: Resource Allocation Simulation
  await test('GET /api/analytics/resource-allocation?county=53033&fte=8', async () => {
    const res = await request('/api/analytics/resource-allocation?county=53033&fte=8');
    if (res.statusCode !== 200 || res.body.totalFteAllocated !== 8) {
      throw new Error('Expected simulation for 8 FTEs');
    }
  });

  // 8. Assessments & Findings Flow
  await test('Assessments & Findings lifecycle', async () => {
    // List assessments
    const listRes = await request('/api/assessments');
    if (listRes.statusCode !== 200 || !Array.isArray(listRes.body)) {
      throw new Error('Failed to list assessments');
    }

    // Create a new finding
    const findingRes = await request('/api/findings', {
      method: 'POST',
      body: {
        assessmentId: 'A-2041',
        tractId: '53033001001',
        note: 'Validation test finding for Chunk 2 verification.'
      }
    });
    if (findingRes.statusCode !== 201 || !findingRes.body._id) {
      throw new Error(`Failed to create finding: ${JSON.stringify(findingRes.body)}`);
    }
  });

  // 9. Report Export Flow
  await test('GET /api/reports/R-118/export?format=csv', async () => {
    const res = await request('/api/reports/R-118/export?format=csv');
    if (res.statusCode !== 200 || !res.body.includes('GEOID,TractName')) {
      throw new Error('Expected CSV output with GEOID header');
    }
  });

  // 10. Data Management Sources
  await test('GET /api/data/sources and /api/session', async () => {
    const [sourceRes, sessionRes] = await Promise.all([
      request('/api/data/sources'),
      request('/api/session')
    ]);
    if (sourceRes.statusCode !== 200 || sourceRes.body.length === 0) {
      throw new Error('Failed to retrieve data sources');
    }
    if (sessionRes.statusCode !== 200 || sessionRes.body.activeJurisdiction !== '53033') {
      throw new Error('Expected default analyst session for 53033');
    }
  });

  console.log(`\n[Results] ${passed} Passed, ${failed} Failed.`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
