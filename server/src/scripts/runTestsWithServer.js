import { spawn } from 'child_process';
import http from 'http';

function checkReady() {
  return new Promise((resolve) => {
    const check = () => {
      http.get('http://localhost:5000/api/health', (res) => {
        if (res.statusCode === 200) resolve();
        else setTimeout(check, 300);
      }).on('error', () => {
        setTimeout(check, 300);
      });
    };
    check();
  });
}

async function main() {
  console.log('[Runner] Starting server...');
  const serverProcess = spawn('node', ['src/index.js'], {
    stdio: 'inherit',
    env: process.env
  });

  await checkReady();
  console.log('[Runner] Server is ready. Running test suite...');

  const testProcess = spawn('node', ['src/scripts/testEndpoints.js'], {
    stdio: 'inherit',
    env: process.env
  });

  testProcess.on('exit', (code) => {
    console.log(`[Runner] Tests completed with code ${code}. Stopping server.`);
    serverProcess.kill();
    process.exit(code);
  });
}

main().catch(err => {
  console.error('[Runner Error]:', err);
  process.exit(1);
});
