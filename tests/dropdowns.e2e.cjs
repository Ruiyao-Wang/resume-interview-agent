const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const scripts = ['core.js', 'project-fields.js', 'select-controls.js', 'preference-values.js', 'education-records.js', 'content.js'];
const cityProfile = { targetCity: '北京，南京，上海，郑州' };
const results = [];
const filter = process.env.DROPDOWN_TEST_FILTER ? new RegExp(process.env.DROPDOWN_TEST_FILTER, 'i') : null;

function citySelect(id, label, options, selected = '') {
  return `<div class="form-item"><label for="${id}">${label}</label><select id="${id}"><option value="">请选择</option>${options.map(([value, text]) => `<option value="${value}"${value === selected ? ' selected' : ''}>${text}</option>`).join('')}</select></div>`;
}

async function fixture(browser, body) {
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);
  await page.setContent(`<!doctype html><html><head><title>合成申请表回归测试</title><style>body { font: 16px sans-serif; } input,select { min-width: 220px; height: 30px; } .form-item { margin: 12px; } [role=option] { padding: 8px; } [hidden] { display: none !important; }</style></head><body><form id="application">${body}<button type="submit">最终投递</button></form></body></html>`);
  await page.evaluate(() => {
    const listeners = [];
    window.__submitted = 0;
    document.querySelector('#application').addEventListener('submit', event => { event.preventDefault(); window.__submitted++; });
    window.chrome = {
      storage: { local: { get: async () => ({}) } },
      runtime: { id: 'synthetic-dropdown-tests', onMessage: { addListener: listener => listeners.push(listener) } }
    };
    window.__fillFixture = payload => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('JOB_FORM_FILL did not respond within 30 seconds')), 30000);
      const respond = result => { clearTimeout(timer); resolve(result); };
      const message = { type: 'JOB_FORM_FILL', includeSensitive: false, onlySensitive: false, ...payload };
      for (const listener of listeners) listener(message, { id: chrome.runtime.id }, respond);
    });
  });
  for (const script of scripts) await page.addScriptTag({ path: path.join(root, script) });
  return page;
}

async function fill(page, payload = { profile: cityProfile }) {
  const result = await page.evaluate(message => window.__fillFixture(message), payload);
  assert.equal(result.error, undefined, JSON.stringify(result));
  assert.equal(await page.evaluate(() => window.__submitted), 0, 'Autofill must not submit the application');
  return result;
}

async function check(name, run) {
  if (filter && !filter.test(name)) return;
  await run();
  results.push(name);
  console.log(`PASS: ${name}`);
}

async function customCityFixture(browser, availableCities) {
  const page = await fixture(browser, '<div class="form-item"><label for="custom-city">意向城市</label><input id="custom-city" aria-controls="city-options" aria-expanded="false" autocomplete="off"><input type="hidden" id="city-code" name="workCityId"></div><div id="city-options" role="listbox" hidden></div><aside><div id="unrelated-options" role="listbox"><div id="unrelated-beijing" role="option">北京市</div></div></aside>');
  await page.evaluate(available => {
    const input = document.querySelector('#custom-city');
    const code = document.querySelector('#city-code');
    const list = document.querySelector('#city-options');
    window.__choiceClicks = 0;
    window.__unrelatedClicks = 0;
    document.querySelector('#unrelated-beijing').addEventListener('click', () => { window.__unrelatedClicks++; });
    let generation = 0;
    const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); };
    const render = () => {
      const current = ++generation;
      list.replaceChildren();
      const query = input.value.replace(/市$/, '').trim();
      if (!query) return;
      setTimeout(() => {
        if (current !== generation) return;
        for (const [value, text] of available.filter(([, text]) => text.includes(query))) {
          const option = document.createElement('div');
          option.setAttribute('role', 'option');
          option.dataset.value = value;
          option.textContent = text;
          option.addEventListener('click', () => {
            window.__choiceClicks++;
            code.value = value;
            input.value = text;
            option.setAttribute('aria-selected', 'true');
            close();
            input.dispatchEvent(new Event('change', { bubbles: true }));
          });
          list.append(option);
        }
      }, 80);
    };
    input.addEventListener('click', () => { list.hidden = false; input.setAttribute('aria-expanded', 'true'); render(); });
    input.addEventListener('input', render);
    input.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
  }, availableCities);
  return page;
}

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.TEST_BROWSER ? { executablePath: process.env.TEST_BROWSER } : {}) });
  try {
    await check('ranked city selectors use ordered stored cities and city suffix aliases', async () => {
      const options = [['beijing', '北京市'], ['nanjing', '南京市'], ['shanghai', '上海市'], ['zhengzhou', '郑州市']];
      const page = await fixture(browser, citySelect('city-first', '第一意向城市', options) + citySelect('city-second', '第二意向城市', options));
      const result = await fill(page);
      assert.equal(await page.locator('#city-first').inputValue(), 'beijing', JSON.stringify(result));
      assert.equal(await page.locator('#city-second').inputValue(), 'nanjing', JSON.stringify(result));
      assert.equal(result.filled.length, 2);
      await page.close();
    });

    await check('unavailable first city falls back to next preferences without duplicates', async () => {
      const options = [['nanjing', '南京市'], ['shanghai', '上海市'], ['zhengzhou', '郑州市']];
      const page = await fixture(browser, citySelect('fallback-first', '第一意向城市', options) + citySelect('fallback-second', '第二意向城市', options));
      const result = await fill(page);
      assert.equal(await page.locator('#fallback-first').inputValue(), 'nanjing', JSON.stringify(result));
      assert.equal(await page.locator('#fallback-second').inputValue(), 'shanghai', JSON.stringify(result));
      await page.close();
    });

    await check('existing manual city is preserved and excluded from subsequent choices', async () => {
      const options = [['beijing', '北京市'], ['nanjing', '南京市'], ['shanghai', '上海市']];
      const page = await fixture(browser, citySelect('manual-first', '第一意向城市', options, 'nanjing') + citySelect('manual-second', '第二意向城市', options));
      const result = await fill(page);
      assert.equal(await page.locator('#manual-first').inputValue(), 'nanjing', JSON.stringify(result));
      assert.equal(await page.locator('#manual-second').inputValue(), 'shanghai', JSON.stringify(result));
      assert.equal(await page.locator('#manual-first').getAttribute('data-job-autofill-filled'), null);
      await page.close();
    });

    await check('editable linked dropdown commits a real option and ignores unrelated open menu', async () => {
      const page = await customCityFixture(browser, [['beijing', '北京市'], ['nanjing', '南京市']]);
      const result = await fill(page, { profile: { targetCity: '北京' } });
      assert.equal(await page.locator('#custom-city').getAttribute('role'), null, 'Fixture must cover no explicit combobox role');
      assert.equal(await page.locator('#custom-city').inputValue(), '北京市', JSON.stringify(result));
      assert.equal(await page.locator('#city-code').inputValue(), 'beijing', 'Typing search text alone must not count as selecting the city');
      assert.equal(await page.evaluate(() => window.__choiceClicks), 1);
      assert.equal(await page.evaluate(() => window.__unrelatedClicks), 0);
      assert.equal(await page.locator('#custom-city').getAttribute('data-job-autofill-filled'), 'true');
      await page.close();
    });

    await check('unmatched dropdown restores temporary search and reports no false success', async () => {
      const page = await customCityFixture(browser, [['chengdu', '成都市']]);
      const result = await fill(page, { profile: { targetCity: '北京' } });
      assert.equal(await page.locator('#custom-city').inputValue(), '', JSON.stringify(result));
      assert.equal(await page.locator('#city-code').inputValue(), '');
      assert.equal(await page.evaluate(() => window.__choiceClicks), 0);
      assert.equal(await page.evaluate(() => window.__unrelatedClicks), 0);
      assert.equal(await page.locator('#custom-city').getAttribute('data-job-autofill-filled'), null);
      assert.equal(await page.locator('#custom-city').evaluate(element => element.style.outline), '');
      assert.equal(result.filled.length, 0);
      assert.ok(result.skipped.length > 0, 'Unmatched dropdown must explain why it was not filled');
      await page.close();
    });

    await check('school selection and precise masters-degree alias commit valid options', async () => {
      const page = await fixture(browser, '<section><h2>教育背景</h2><div class="form-item"><label for="degree-school">毕业院校</label><select id="degree-school"><option value="">请选择</option><option value="school-ms">演示硕士大学</option></select></div><div class="form-item"><label for="degree-level">学历</label><select id="degree-level"><option value="">请选择</option><option value="bs">本科</option><option value="ms">硕士研究生</option><option value="phd">博士研究生</option></select></div></section>');
      const result = await fill(page, { profile: { school: '演示硕士大学', degree: '硕士' } });
      assert.equal(await page.locator('#degree-school').inputValue(), 'school-ms', JSON.stringify(result));
      assert.equal(await page.locator('#degree-level').inputValue(), 'ms', JSON.stringify(result));
      assert.equal(result.filled.length, 2);
      await page.close();
    });

    await check('two education cards map their actual records and preserve manual fields', async () => {
      const recordCard = (prefix, title, manualMajor = '') => `<section class="education-card"><h2>${title}</h2><div class="form-item"><label for="${prefix}-school">学校</label><select id="${prefix}-school"><option value="">请选择</option><option value="school-bs">演示本科大学</option><option value="school-ms">演示硕士大学</option></select></div><div class="form-item"><label for="${prefix}-degree">学历</label><select id="${prefix}-degree"><option value="">请选择</option><option value="bs">大学本科</option><option value="ms">硕士研究生</option></select></div><div class="form-item"><label for="${prefix}-major">专业</label><input id="${prefix}-major" value="${manualMajor}"></div><div class="form-item"><label for="${prefix}-graduation">毕业时间</label><input id="${prefix}-graduation" type="month"></div></section>`;
      const page = await fixture(browser, recordCard('bs', '本科', '手动填写的专业') + recordCard('ms', '硕士'));
      const result = await fill(page, {
        profile: {
          school: '演示硕士大学', degree: '硕士', major: '电气工程', graduationDate: '2027-06',
          _educationRecords: [
            { school: '演示本科大学', degree: '本科', major: '通信工程', graduationDate: '2024-06' },
            { school: '演示硕士大学', degree: '硕士', major: '电气工程', graduationDate: '2027-06' }
          ],
          _primaryEducation: 1
        }
      });
      assert.equal(await page.locator('#bs-school').inputValue(), 'school-bs', JSON.stringify(result));
      assert.equal(await page.locator('#bs-degree').inputValue(), 'bs', JSON.stringify(result));
      assert.equal(await page.locator('#bs-major').inputValue(), '手动填写的专业');
      assert.equal(await page.locator('#bs-major').getAttribute('data-job-autofill-filled'), null);
      assert.equal(await page.locator('#bs-graduation').inputValue(), '2024-06', JSON.stringify(result));
      assert.equal(await page.locator('#ms-school').inputValue(), 'school-ms', JSON.stringify(result));
      assert.equal(await page.locator('#ms-degree').inputValue(), 'ms', JSON.stringify(result));
      assert.equal(await page.locator('#ms-major').inputValue(), '电气工程', JSON.stringify(result));
      assert.equal(await page.locator('#ms-graduation').inputValue(), '2027-06', JSON.stringify(result));
      await page.close();
    });

    await check('education level and academic degree use one record and preserve native date precision', async () => {
      const page = await fixture(browser, '<section class="education-card"><h2>本科</h2><div class="form-item"><label for="level-control">学历</label><select id="level-control"><option value="">请选择</option><option value="bachelor-level">大学本科</option><option value="master-level">硕士研究生</option></select></div><div class="form-item"><label for="credential-control">学位</label><select id="credential-control"><option value="">请选择</option><option value="bachelor-degree">学士学位</option><option value="master-degree">硕士学位</option></select></div><div class="form-item"><label for="enrollment-control">入学时间</label><input id="enrollment-control" type="month"></div><div class="form-item"><label for="graduation-control">毕业时间</label><input id="graduation-control" type="date"></div></section>');
      const result = await fill(page, { profile: { degree: '本科', startDate: '2020-09', graduationDate: '2024-06-30' } });
      assert.equal(await page.locator('#level-control').inputValue(), 'bachelor-level', JSON.stringify(result));
      assert.equal(await page.locator('#credential-control').inputValue(), 'bachelor-degree', JSON.stringify(result));
      assert.equal(await page.locator('#enrollment-control').inputValue(), '2020-09', JSON.stringify(result));
      assert.equal(await page.locator('#graduation-control').inputValue(), '2024-06-30', JSON.stringify(result));
      assert.equal(result.filled.length, 4);
      await page.close();
    });

    await check('month-only education dates do not invent a day for native date controls', async () => {
      const page = await fixture(browser, '<section class="education-card"><h2>教育背景</h2><div class="form-item"><label for="enrollment-control">入学时间</label><input id="enrollment-control" type="date"></div><div class="form-item"><label for="graduation-control">毕业时间</label><input id="graduation-control" type="date"></div></section>');
      const result = await fill(page, { profile: { startDate: '2025-09', graduationDate: '2027-06' } });
      assert.equal(await page.locator('#enrollment-control').inputValue(), '', JSON.stringify(result));
      assert.equal(await page.locator('#graduation-control').inputValue(), '', JSON.stringify(result));
      assert.equal(result.filled.length, 0);
      assert.equal(result.skipped.length, 2);
      assert.ok(result.skipped.every(item => /日期精度/.test(item.reason)));
      await page.close();
    });

    await check('explicit education captions override conflicting technical field identifiers', async () => {
      const page = await fixture(browser, '<section class="education-card"><h2>教育资料</h2><div class="form-item"><label for="educationLevel">学校</label><select id="educationLevel"><option value="">请选择</option><option value="saved-university">演示硕士大学</option></select></div><div class="form-item"><label for="university">学历</label><select id="university"><option value="">请选择</option><option value="bachelor-level">大学本科</option><option value="master-level">硕士研究生</option></select></div><div class="form-item"><label for="graduationDate">入学年份</label><input id="graduationDate" type="text"></div></section>');
      const result = await fill(page, { profile: { school: '演示硕士大学', degree: '硕士', startDate: '2025-09', graduationDate: '2027-06' } });
      assert.equal(await page.locator('#educationLevel').inputValue(), 'saved-university', JSON.stringify(result));
      assert.equal(await page.locator('#university').inputValue(), 'master-level', JSON.stringify(result));
      assert.equal(await page.locator('#graduationDate').inputValue(), '2025', 'Visible 入学年份 must use enrollment year despite the graduationDate ID: ' + JSON.stringify(result));
      assert.equal(result.filled.length, 3);
      await page.close();
    });
    console.log(`PASS: ${results.length} dropdown/application scenarios; no real profile, backend, or submissions used`);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
