// Real HTTP + browser journey. All fixtures and SQLite files live in a new temp directory.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const port = 8767;
const base = `http://127.0.0.1:${port}`;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function selectablePdf() {
  const text = 'BT /F1 12 Tf 45 730 Td (Demo Candidate) Tj 0 -20 Td (Education: Example University, Computer Science Bachelor 2023-2027) Tj 0 -20 Td (Skills: Python SQL PyTorch Git) Tj 0 -20 Td (Project: Model evaluation course project, cleaned public data.) Tj 0 -20 Td (Measured prediction errors, compared a baseline. No employment experience.) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`
  ];
  let content = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(content));
    content += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const startXref = Buffer.byteLength(content);
  content += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  content += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  content += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${startXref}\n%%EOF\n`;
  return Buffer.from(content);
}

async function jsonResponse(page, endpoint, action) {
  const received = page.waitForResponse(response => response.url().endsWith(endpoint) && response.request().method() === 'POST');
  await action();
  const response = await received;
  const body = await response.json();
  assert(response.ok(), JSON.stringify(body));
  return body;
}

(async () => {
  await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', () => reject(new Error('Interview test port 8767 is occupied; no existing server will be modified.')));
    probe.listen(port, '127.0.0.1', () => probe.close(resolve));
  });
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'interview-browser-e2e-'));
  const python = process.env.TEST_PYTHON || path.join(root, 'backend', '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const server = spawn(python, ['-m', 'uvicorn', 'app:app', '--host', '127.0.0.1', '--port', String(port)], {
    cwd: path.join(root, 'backend'),
    env: { ...process.env, JOB_AUTOFILL_DATA_DIR: path.join(scratch, 'data'), AGENT_PROVIDER: 'mock', LLM_API_KEY: '', LLM_MODEL: '', APP_ACCESS_TOKEN: '', APP_ALLOWED_HOSTS: '127.0.0.1,localhost,testserver', APP_ALLOWED_ORIGINS: '' },
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
  });
  let serverLog = '', browser;
  server.stdout.on('data', chunk => { serverLog += chunk; });
  server.stderr.on('data', chunk => { serverLog += chunk; });
  server.on('error', error => { serverLog += error.message; });
  try {
    let ready = false, readinessError = '';
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        const response = await fetch(base + '/api/health');
        ready = response.ok;
        if (!ready) readinessError = `HTTP ${response.status}`;
      } catch (error) {
        readinessError = error.message;
      }
      if (ready) break;
      if (server.exitCode !== null) break;
      await pause(150);
    }
    assert(ready, `Mock test server failed: ${readinessError}\n${serverLog}`);
    browser = await chromium.launch({ headless: true, ...(process.env.TEST_BROWSER ? { executablePath: process.env.TEST_BROWSER } : {}) });
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    page.setDefaultTimeout(20000);
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto(base + '/interview');
    await page.locator('#demoButton').waitFor({ state: 'visible' });
    const demo = await jsonResponse(page, '/api/agent/demo', () => page.locator('#demoButton').click());
    await page.waitForFunction(jd => document.getElementById('jdInput').value === jd, demo.jd);

    // Exercise the actual upload widget in addition to the example button.
    await page.locator('#resumeFile').setInputFiles({ name: 'synthetic-resume.pdf', mimeType: 'application/pdf', buffer: selectablePdf() });
    const uploaded = await jsonResponse(page, '/api/agent/resumes', () => page.locator('#uploadButton').click());
    assert(uploaded.text.includes('Python SQL'));
    await page.locator('#jdInput').fill(demo.jd + '\n能够解释 Python 数据清洗与模型评测的具体步骤。');
    await page.locator('#sessionTitle').fill('Browser E2E synthetic interview');
    await page.locator('#questionCount').selectOption('3');
    const preparedPromise = page.waitForResponse(response => /\/api\/agent\/sessions\/[^/]+\/prepare$/.test(response.url()) && response.request().method() === 'POST');
    await page.locator('#createButton').click();
    const preparedResponse = await preparedPromise;
    assert(preparedResponse.ok(), await preparedResponse.text());
    let session = await preparedResponse.json();
    assert.equal(session.status, 'awaiting_answer');
    assert.equal(session.mode, 'mock');
    await page.locator('#analysisPanel').waitFor({ state: 'visible' });
    await page.waitForFunction(prompt => document.getElementById('currentQuestion').textContent.includes(prompt), session.current_question.prompt);
    assert((await page.locator('#analysisPanel').innerText()).length > 30);

    for (let attempt = 0; attempt < 10 && session.status !== 'ready_report'; attempt++) {
      await page.locator('#answerInput').fill('我还没有这方面的独立实践经验，只知道基本概念，暂时无法确认具体实现。');
      session = await jsonResponse(page, `/api/agent/sessions/${session.id}/answer`, () => page.locator('#answerButton').click());
      if (session.current_question) {
        await page.waitForFunction(prompt => document.getElementById('currentQuestion').textContent.includes(prompt), session.current_question.prompt);
      }
    }
    assert.equal(session.status, 'ready_report');
    assert(session.turns.length > 3 && session.turns.length <= 6, 'Weak answers should trigger bounded follow-ups');
    const finished = await jsonResponse(page, `/api/agent/sessions/${session.id}/finish`, () => page.locator('#finishButton').click());
    assert.equal(finished.status, 'completed');
    await page.locator('#reportPanel').waitFor({ state: 'visible' });
    assert((await page.locator('#reportPanel').innerText()).length > 50);

    await page.locator('.review-item > summary').first().click();
    const review = page.locator('.review-form').first();
    await review.waitFor({ state: 'visible' });
    await review.locator('.review-answer').fill('我没有做过生产部署。我在课程中使用公开数据，先划分独立测试集，再与基线比较误差，检查失败样本并记录局限。');
    await jsonResponse(page, `/api/agent/sessions/${session.id}/review`, () => review.locator('.review-submit').click());
    const persisted = await (await page.request.get(base + `/api/agent/sessions/${session.id}`)).json();
    assert.equal(persisted.reviews.length, 1);
    assert.equal(persisted.turns.length, finished.turns.length);

    await page.reload();
    await page.locator(`#historyList [data-session-id="${session.id}"] .open-session`).click();
    await page.locator('#reportPanel').waitFor({ state: 'visible' });
    assert((await page.locator('#reportPanel').innerText()).length > 50);
    const restored = await (await page.request.get(base + `/api/agent/sessions/${session.id}`)).json();
    assert.deepEqual(restored.report, persisted.report);
    assert.equal(restored.reviews.length, 1);
    assert.deepEqual(pageErrors, [], 'No uncaught browser JavaScript errors');
    await page.screenshot({ path: path.join(scratch, 'interview-report.png'), fullPage: true });
    console.log('PASS: Mock example, PDF upload, JD editing, matching, multi-turn follow-ups, report, review, persistent history and browser error checks.');
  } finally {
    try {
      if (browser) await browser.close();
    } finally {
      server.kill();
      console.log('Synthetic interview E2E workspace: ' + scratch);
    }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
