const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const port = 8766;
const base = `http://127.0.0.1:${port}`;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  // Never run fixtures against an existing personal material server.
  await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', () => reject(new Error('测试专用8766端口已占用，请先结束其他测试')));
    probe.listen(port, '127.0.0.1', () => probe.close(resolve));
  });
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'job-autofill-e2e-'));
  const python = process.env.TEST_PYTHON || path.join(root, 'backend', '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const server = spawn(python, ['-m', 'uvicorn', 'app:app', '--host', '127.0.0.1', '--port', String(port)], {
    cwd: path.join(root, 'backend'), env: { ...process.env, JOB_AUTOFILL_DATA_DIR: path.join(scratch, 'data'), AGENT_PROVIDER: 'mock', APP_ACCESS_TOKEN: '', APP_ALLOWED_HOSTS: '127.0.0.1,localhost,testserver', APP_ALLOWED_ORIGINS: '', LLM_API_KEY: '', LLM_MODEL: '' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
  });
  let serverLog = '', context;
  server.stderr.on('data', chunk => serverLog += chunk);
  server.on('error', error => serverLog += error.message);
  try {
    let ready = false, readinessError = '';
    for (let i = 0; i < 70; i++) {
      try { ready = (await fetch(base + '/api/health')).ok; } catch (error) { readinessError = error.message; }
      if (ready) break;
      await pause(150);
    }
    assert(ready, readinessError + '\n' + serverLog);
    context = await chromium.launchPersistentContext(path.join(scratch, 'browser'), {
      channel: 'chromium', headless: true,
      ...(process.env.TEST_BROWSER ? { executablePath: process.env.TEST_BROWSER } : {}),
      args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
    });
    context.setDefaultTimeout(15000);
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 15000 });
    const id = new URL(worker.url()).host;
    const library = await context.newPage();
    await library.goto(base);
    await library.waitForFunction(() => document.getElementById('resumeList').textContent.includes('尚未'));
    await library.waitForFunction(() => !document.getElementById('savePersonal').disabled);
    await library.locator('#personalForm [name=fullNameCn]').fill('演示测试员');
    await library.locator('#personalForm [name=email]').fill('demo@example.test');
    await library.locator('#addEducation').click();
    await library.locator('[data-education-key=school]').first().fill('演示本科大学');
    await library.locator('[data-education-key=degree]').first().fill('本科');
    await library.locator('#addEducation').click();
    await library.locator('[data-education-key=school]').last().fill('演示硕士大学');
    await library.locator('[data-education-key=degree]').last().fill('硕士');
    await library.locator('input[name=primaryEducation]').last().check();
    await library.locator('#savePersonal').click();
    await library.waitForFunction(() => document.getElementById('personalStatus').textContent.includes('已保存'));
    await library.reload();
    await library.waitForFunction(() => !document.getElementById('savePersonal').disabled);
    assert.equal(await library.locator('#personalForm [name=fullNameCn]').inputValue(), '演示测试员');
    assert.equal(await library.locator('.education-record').count(), 2);
    assert(await library.locator('input[name=primaryEducation]').last().isChecked());
    const merged = await (await library.request.post(base + '/api/profile/import', { data: { profile: { fullNameCn: '旧名字不能覆盖', currentCity: '演示城市' } } })).json();
    assert.equal(merged.profile.fullNameCn, '演示测试员');
    assert.equal(merged.profile.currentCity, '演示城市');
    assert.equal(merged.education.length, 2);
    assert.equal((await library.request.get(base + '/dashboard/style.css')).status(), 200);
    await library.locator('#resumeForm [name=name]').fill('演示视觉版');
    await library.locator('#resumeForm [name=tags]').fill('Python, PyTorch, 模型评测');
    await library.locator('#resumeForm [type=file]').setInputFiles({ name: 'demo-resume.txt', mimeType: 'text/plain', buffer: Buffer.from('Synthetic resume: Python PyTorch 模型评测') });
    await library.locator('#resumeForm button').click();
    await library.locator('#resumeList').getByText('演示视觉版', { exact: true }).waitFor();
    await library.getByRole('button', { name: '编辑名称与标签', exact: true }).click();
    await library.getByLabel('简历适用方向').fill('编辑后的模型评测方向');
    await library.getByLabel('简历标签', { exact: true }).fill('Python, PyTorch, 模型评测, 数据分析');
    await library.locator('#resumeEditForm button[type=submit]').click();
    await library.locator('#resumeList').getByText('编辑后的模型评测方向', { exact: true }).waitFor();
    const editedResumes = await (await library.request.get(base + '/api/resumes')).json();
    assert.equal(editedResumes.length, 1);
    assert(editedResumes[0].tags.includes('数据分析'));
    const projects = [
      { project_name: '演示视觉项目', variant_name: '评测版', content: '使用 PyTorch 分析模型评测误差。', responsibilities: '评测数据分析', role: '项目成员', start_date: '2025-09', end_date: '2025-11' },
      { project_name: '演示视觉项目', variant_name: '硬件版', content: '电路焊接。', responsibilities: '硬件调试' },
      { project_name: '演示数据项目', variant_name: '通用版', content: 'Python 数据质量分析。', responsibilities: '分析误差', role: '项目成员', start_date: '2025-10', end_date: '2025-12' }
    ];
    for (const project of projects) {
      const response = await library.request.post(base + '/api/projects', { data: project });
      assert.equal(response.status(), 200);
    }
    await library.reload();
    await library.getByRole('button', { name: '编辑 评测版', exact: true }).click();
    await library.locator('#projectForm [name=responsibilities]').fill('经过修改的评测职责');
    const projectSave = library.waitForResponse(r => r.url().endsWith('/api/projects') && r.request().method() === 'POST');
    await library.getByRole('button', { name: '保存/更新该表述', exact: true }).click();
    assert.equal((await projectSave).status(), 200);
    const editedProjects = await (await library.request.get(base + '/api/projects')).json();
    assert.equal(editedProjects.length, 2);
    const editedProject = editedProjects.find(p => p.name === '演示视觉项目');
    assert.equal(editedProject.variants.length, 2);
    assert.equal(editedProject.variants.find(v => v.name === '评测版').responsibilities, '经过修改的评测职责');
    assert.equal(editedProject.variants.find(v => v.name === '硬件版').content, '电路焊接。');
    const denied = await library.request.post(base + '/api/match', { headers: { Origin: 'https://unrelated.example' }, data: { job_description: 'test' } });
    assert.equal(denied.status(), 403);
    const demo = await context.newPage();
    await demo.goto(base + '/dashboard/demo.html');
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await popup.evaluate(async port => chrome.storage.local.set({ backendPort: port }), port);
    // A separate tab hosts the popup during automation; direct its active-tab query to our fixture.
    const tabId = await popup.evaluate(async url => (await chrome.tabs.query({})).find(t => t.url === url).id, demo.url());
    await popup.evaluate(({ tabId, url }) => { chrome.tabs.query = async () => [{ id: tabId, url }]; }, { tabId, url: demo.url() });
    await popup.locator('#extractJob').click();
    await popup.waitForFunction(() => document.getElementById('jobText').value.includes('PyTorch'));
    await popup.locator('#matchJob').click();
    await popup.locator('.projectChoice').first().waitFor();
    assert.equal(await popup.locator('.projectChoice').count(), 2);
    assert((await popup.locator('#selection').innerText()).includes('评测版'));
    await popup.getByLabel('演示视觉项目的表述版本').selectOption({ label: '硬件版' });
    assert((await popup.locator('.variantPreview').allTextContents()).some(text => text.includes('电路焊接。')));
    await popup.locator('#fillProjects').click();
    await popup.waitForFunction(() => document.getElementById('result').textContent.includes('已填写'));
    const names = demo.getByLabel('项目名称', { exact: true });
    assert.equal(await names.count(), 2, await popup.locator('#result').innerText());
    assert.deepEqual(new Set(await names.evaluateAll(elements => elements.map(el => el.value))), new Set(['演示视觉项目', '演示数据项目']));
    assert.equal(await demo.getByLabel('姓名', { exact: true }).inputValue(), '');
    const contents = await demo.locator('#projectCards .card').evaluateAll(cards => Object.fromEntries(cards.map(card => [card.querySelector('[aria-label="项目名称"]').value, card.querySelector('[aria-label="项目简述"]').value])));
    assert.equal(contents['演示视觉项目'], '电路焊接。');
    assert.equal(contents['演示数据项目'], 'Python 数据质量分析。');
    await demo.getByLabel('项目简述', { exact: true }).first().fill('用户手动修改，必须保留');
    await popup.locator('#fillProjects').click();
    await popup.waitForFunction(() => document.getElementById('result').textContent.includes('已填写'));
    assert.equal(await names.count(), 2);
    assert.equal(await demo.getByLabel('项目简述', { exact: true }).first().inputValue(), '用户手动修改，必须保留');
    await popup.locator('#scanUpload').click();
    await popup.locator('#attachResume').waitFor({ state: 'visible' });
    await popup.locator('#attachResume').click();
    await demo.waitForFunction(() => document.getElementById('fileStatus').textContent.includes('demo-resume.txt'));
    assert.equal(await demo.locator('input[accept="image/*"]').evaluate(el => el.files.length), 0);
    await popup.locator('.projectChoice').first().uncheck();
    await pause(100);
    await popup.reload();
    await popup.locator('.projectChoice').first().waitFor();
    assert.equal(await popup.locator('.projectChoice').first().isChecked(), false);
    assert.equal(await popup.getByLabel('演示视觉项目的表述版本').locator('option:checked').textContent(), '硬件版');
    await demo.reload();
    await popup.evaluate(({ tabId, url }) => { chrome.tabs.query = async () => [{ id: tabId, url }]; }, { tabId, url: demo.url() });
    await popup.locator('#smartFill').click();
    await popup.waitForFunction(() => document.getElementById('result').textContent.includes('项目已填写'));
    assert.equal(await demo.getByLabel('姓名', { exact: true }).inputValue(), '演示测试员');
    assert.equal(await demo.getByLabel('电子邮箱', { exact: true }).inputValue(), 'demo@example.test');
    assert.equal(await demo.getByLabel('项目名称', { exact: true }).count(), 2);
    assert((await demo.locator('#fileStatus').innerText()).includes('demo-resume.txt'));
    // Application pages without a JD reuse the recent identified job on the same site.
    await demo.reload();
    await demo.locator('article').evaluate(el => el.remove());
    await popup.locator('#smartFill').click();
    await popup.waitForFunction(() => document.getElementById('result').textContent.includes('项目已填写'));
    assert.equal(await demo.getByLabel('项目名称', { exact: true }).count(), 2);
    assert.equal(await demo.getByLabel('姓名', { exact: true }).inputValue(), '演示测试员');
    const traversal = await library.request.get(base + '/api/resumes/not-a-real-id/attachment');
    assert.equal(traversal.status(), 404);
    await demo.evaluate(() => {
      const select = document.createElement('select'); select.id = 'school-test'; select.setAttribute('aria-label', '毕业院校');
      select.innerHTML = '<option value="0">请选择</option>';
      select.addEventListener('focus', () => setTimeout(() => select.add(new Option('演示硕士大学', 'university-id')), 250), { once: true });
      document.querySelector('main').append(select);
    });
    await popup.locator('#fillSafe').click();
    await demo.waitForFunction(() => document.getElementById('school-test').value === 'university-id');
    for (const exactMatch of [true, false]) {
      await demo.evaluate(exactMatch => {
        document.getElementById('school-test')?.remove(); document.getElementById('school-list')?.remove();
        const input = document.createElement('input'); input.id = 'school-test'; input.setAttribute('role', 'combobox'); input.setAttribute('aria-label', '毕业院校'); input.setAttribute('aria-controls', 'school-list');
        const list = document.createElement('div'); list.id = 'school-list'; list.setAttribute('role', 'listbox'); list.hidden = true;
        input.addEventListener('click', () => { list.hidden = false; });
        input.addEventListener('keydown', e => { if (e.key === 'Escape') list.hidden = true; });
        input.addEventListener('input', () => {
          list.replaceChildren();
          if (!input.value) return;
          setTimeout(() => {
            const option = document.createElement('div'); option.setAttribute('role', 'option'); option.textContent = exactMatch ? '演示硕士大学' : '演示硕士大学附属学院';
            option.addEventListener('click', () => { input.value = option.textContent; option.setAttribute('aria-selected', 'true'); list.hidden = true; });
            list.append(option);
          }, 200);
        });
        document.querySelector('main').append(input, list);
      }, exactMatch);
      await popup.locator('#fillSafe').click();
      await popup.waitForFunction(() => document.getElementById('result').textContent.includes('已填写'));
      assert.equal(await demo.locator('#school-test').inputValue(), exactMatch ? '演示硕士大学' : '');
    }
    // No familiar section heading: labels, aria-labelledby and attributes still identify the form.
    await demo.evaluate(() => {
      document.title = 'Step 2';
      document.querySelector('main').innerHTML = '<div><span id="institution-label">Institution attended</span><select aria-labelledby="institution-label" id="institution"><option value="">Select</option><option value="uni">演示硕士大学</option></select></div><div><span>E-mail address</span><input id="alternate-email"></div><div><span>Full legal name</span><input id="alternate-name"></div>';
    });
    await popup.locator('#smartFill').click();
    await popup.waitForFunction(() => document.getElementById('result').textContent.includes('个人信息已填写'));
    assert.equal(await demo.locator('#institution').inputValue(), 'uni');
    assert.equal(await demo.locator('#alternate-email').inputValue(), 'demo@example.test');
    assert.equal(await demo.locator('#alternate-name').inputValue(), '演示测试员');
    // A uniquely linked same-site job description can be read without copying or switching tabs.
    await context.route('**/job-fallback', route => route.fulfill({ contentType: 'text/html', body: '<html><head><title>Computer Vision Engineer — Campus</title></head><body><article><h1>Computer Vision Engineer</h1><h2>What you will do</h2><p>Build and evaluate Python and PyTorch models for computer vision applications.</p><h2>What you will bring</h2><p>Knowledge of machine learning and a masters degree. Apply now.</p></article></body></html>' }));
    await demo.evaluate(() => { const a = document.createElement('a'); a.href = '/job-fallback'; a.textContent = 'View job details'; document.querySelector('main').append(a); });
    await popup.locator('#smartFill').click();
    await popup.waitForFunction(() => document.getElementById('result').textContent.includes('Computer Vision Engineer'));
    assert((await popup.locator('#selection').innerText()).includes('Computer Vision Engineer'));
    // Structured JobPosting supports unconventional website section names.
    await demo.evaluate(() => {
      document.title = 'Position 123';
      document.querySelector('main').innerHTML = '<p>Open opportunity</p>';
      const node = document.createElement('script'); node.type = 'application/ld+json';
      node.textContent = JSON.stringify({ '@type': 'JobPosting', title: 'Wireless Systems Engineer', description: '<p>Explore wireless communication and MATLAB system simulations. Build a link budget and evaluate model performance with Python.</p>' });
      document.body.append(node);
    });
    await popup.locator('#smartFill').click();
    await popup.waitForFunction(() => document.getElementById('result').textContent.includes('Wireless Systems Engineer'));
    for (const structured of [true, false]) {
      await demo.evaluate(structured => {
        document.querySelectorAll('script[type="application/ld+json"]').forEach(node => node.remove());
        document.title = '招聘';
        document.querySelector('main').innerHTML = '<h1>招聘</h1><article><h2>Python Engineer</h2><p>Job responsibilities: develop Python applications and evaluate performance for full-time employment. Apply now.</p></article><article><h2>Wireless Systems Engineer</h2><p>Job responsibilities: design wireless communication systems and evaluate MATLAB simulations. Apply now.</p></article>';
        if (structured) {
          const node = document.createElement('script'); node.type = 'application/ld+json';
          node.textContent = JSON.stringify({ '@graph': [
            { '@type': 'JobPosting', title: 'Python Engineer', description: 'Build Python applications and evaluate performance in a full-time software engineering role.' },
            { '@type': 'JobPosting', title: 'Wireless Systems Engineer', description: 'Design wireless communication systems and evaluate MATLAB simulations for our research team.' }
          ] });
          document.body.append(node);
        }
      }, structured);
      await popup.locator('#smartFill').click();
      await popup.waitForFunction(() => document.getElementById('result').textContent.includes('包含多个岗位'));
    }
    console.log('PASS: cross-wording forms, contextual labels, linked JD, structured jobs, schools, unified profile and existing workflows');
  } finally {
    if (context) await context.close();
    server.kill();
    // Keep only synthetic temporary fixtures for troubleshooting; never touches user storage.
    console.log('Synthetic test workspace: ' + scratch);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
