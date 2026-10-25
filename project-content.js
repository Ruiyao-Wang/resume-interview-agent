(function () {
  "use strict";
  if (globalThis.jobProjectListenerInstalled) return;
  globalThis.jobProjectListenerInstalled = true;
  const ui = globalThis.JobFormContent;
  const fields = globalThis.JobProjectFields;
  const fieldLabels = { project_name: "项目名称", start_date: "开始时间", end_date: "结束时间", role: "项目角色", organization: "所属机构", responsibilities: "本人职责", content: "项目简述" };
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

  function projectNames(scope = document) {
    return ui.candidateElements().filter(el => scope.contains(el) && fields.projectField(ui.fieldContext(el), ui.sectionContext(el)) === "project_name");
  }

  function projectGroup(nameElement) {
    let parent = nameElement.parentElement;
    let best = parent;
    while (parent && parent !== document.body && parent !== document.documentElement) {
      const names = projectNames(parent);
      if (names.length !== 1) break;
      // Stop before an encompassing application form with unrelated experience sections.
      if (/教育经历|工作经历|实习经历|education history|work experience/i.test(parent.innerText || "")) break;
      best = parent;
      parent = parent.parentElement;
    }
    return best;
  }

  function extractJob() {
    const selection = String(window.getSelection() || "").trim();
    const fieldLabels = ui.candidateElements().map(element => ui.fieldContext(element));
    const headings = [...document.querySelectorAll("h1,h2,h3,h4,[role='heading']")].filter(ui.visible).map(ui.captionText).filter(text => text && text.length < 100);
    function cleanText(element) {
      const clone = element.cloneNode(true);
      clone.querySelectorAll("script,style,nav,aside,input,select,textarea,[contenteditable],[role=option]").forEach(node => node.remove());
      return String(clone.textContent || "").replace(/[\t ]+/g, " ").slice(0, 40000);
    }
    const regions = [...new Set([...document.querySelectorAll("article, main, [role='main'], [itemprop='description'], .job-description, .job-detail, .position-detail"), document.body])].filter(ui.visible);
    const candidates = regions.map(region => {
      const text = cleanText(region);
      const title = region.querySelector("h1,h2")?.innerText || document.title;
      return { title, text, source: "页面正文", regionKind: region.tagName, ...globalThis.JobPageContext.analyze({ title, text, fieldLabels, headings, url: location.href }) };
    });
    if (selection.length > 40) candidates.push({ title: document.title, text: selection.slice(0, 40000), source: "所选文字", ...globalThis.JobPageContext.analyze({ title: document.title, text: selection, fieldLabels, headings, selection, url: location.href }) });
    // Standard structured job data is stronger evidence than a website's choice of section wording.
    const queue = [];
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      if (script.textContent.length > 200000) continue;
      try { queue.push(JSON.parse(script.textContent)); } catch {}
    }
    const structured = [];
    for (let seen = 0; queue.length && seen < 200; seen++) {
      const node = queue.shift();
      if (Array.isArray(node)) { queue.push(...node.slice(0, 50)); continue; }
      if (!node || typeof node !== "object") continue;
      if (node['@graph']) queue.push(node['@graph']);
      if (node.mainEntity) queue.push(node.mainEntity);
      const types = Array.isArray(node['@type']) ? node['@type'] : [node['@type']];
      if (types.includes('JobPosting') && typeof node.description === 'string' && typeof node.title === 'string') {
        const parsed = new DOMParser().parseFromString(node.description, 'text/html');
        const text = cleanText(parsed.body);
        if (text.trim().length > 50) structured.push({ title: node.title, text, source: "网站岗位结构化数据", isJobDetail: true, confidence: 1, reasons: ["JobPosting数据"] });
      }
    }
    // A listing page with multiple jobs must not silently choose the first posting.
    if (structured.length === 1) candidates.push(structured[0]);
    const articleJobs = new Set(candidates.filter(candidate => candidate.regionKind === "ARTICLE" && candidate.isJobDetail).map(candidate => (candidate.jobTitle || candidate.title).trim().toLowerCase()));
    const ambiguousJobs = structured.length > 1 || structured.length === 0 && articleJobs.size > 1;
    candidates.sort((a, b) => Number(b.isJobDetail) - Number(a.isJobDetail) || b.confidence - a.confidence || a.text.length - b.text.length);
    const best = candidates[0] || { title: document.title, text: "", isJobDetail: false, confidence: 0 };
    const application = globalThis.JobPageContext.analyze({ title: document.title, text: cleanText(document.body), headings, fieldLabels, url: location.href });
    return { ...best, title: ambiguousJobs ? document.title : best.jobTitle || best.title, isJobDetail: !ambiguousJobs && best.isJobDetail, ambiguousJobs, isApplication: application.isApplication, applicationReasons: application.reasons, fieldCount: fieldLabels.length, url: location.href };
  }

  function findAddButton(group) {
    const scopes = [group, group?.parentElement, group?.parentElement?.parentElement].filter(Boolean);
    for (const scope of scopes) {
      if (scope === document.body || scope === document.documentElement) continue;
      if (/教育经历|工作经历|实习经历/.test(scope.innerText || "")) continue;
      const buttons = [...scope.querySelectorAll("button, [role='button'], a, input[type='button']")].filter(el => {
        const text = (el.innerText || el.value || "").trim().replace(/\s/g, "");
        return ui.visible(el) && !el.disabled && !(el.tagName === "BUTTON" && el.type === "submit") && /^(?:\+|＋)?(?:添加|新增)(?:项目|项目经历)?$/.test(text);
      });
      if (buttons.length === 1) return buttons[0];
    }
    return null;
  }

  async function readLinkedJob() {
    const links = [...document.querySelectorAll("a[href]")].filter(ui.visible).filter(link => /岗位详情|职位详情|查看岗位|查看职位|查看招聘要求|job details|view (?:job|role)|role details/i.test(ui.captionText(link)));
    const urls = [...new Set(links.map(link => {
      try { const url = new URL(link.href, location.href); url.hash = ""; return url.origin === location.origin && /^https?:$/.test(url.protocol) && url.href !== location.href.split("#")[0] ? url.href : ""; } catch { return ""; }
    }).filter(Boolean))];
    if (urls.length !== 1) return { found: false };
    try {
      const response = await fetch(urls[0], { credentials: "same-origin", signal: AbortSignal.timeout(4000) });
      if (!response.ok || new URL(response.url).origin !== location.origin) return { found: false };
      const html = await response.text();
      if (html.length > 1500000) return { found: false };
      const documentCopy = new DOMParser().parseFromString(html, "text/html");
      documentCopy.querySelectorAll("script,style,nav,aside,input,select,textarea").forEach(node => node.remove());
      const region = documentCopy.querySelector("article,main,[role=main]") || documentCopy.body;
      const text = region.textContent.slice(0, 40000);
      const title = documentCopy.title;
      const headings = [...documentCopy.querySelectorAll("h1,h2,h3")].map(el => el.textContent.trim());
      const assessment = globalThis.JobPageContext.analyze({ title, text, headings, fieldLabels: [], url: response.url });
      return assessment.isJobDetail ? { found: true, job: { ...assessment, title: assessment.jobTitle || title, text, url: response.url, source: "申请页关联的岗位详情" } } : { found: false };
    } catch { return { found: false }; }
  }

  async function fillProjects(projects) {
    const filled = [], skipped = [];
    const usedGroups = new Set();
    for (const project of projects.slice(0, 6)) {
      let names = projectNames();
      let name = names.find(el => !usedGroups.has(el) && el.value.trim() === project.project_name);
      if (!name) name = names.find(el => !usedGroups.has(el) && ui.isEmpty(el));
      if (!name && names.length) {
        const add = findAddButton(projectGroup(names[names.length - 1]));
        if (add) {
          const oldNames = new Set(names);
          add.click();
          for (let attempt = 0; attempt < 15; attempt++) {
            await delay(100);
            name = projectNames().find(el => !oldNames.has(el) && ui.isEmpty(el));
            if (name) break;
          }
        }
      }
      if (!name) { skipped.push(`${project.project_name}：未找到空白项目栏，请在网站添加项目后再点填写`); continue; }
      usedGroups.add(name);
      const group = projectGroup(name);
      const candidates = ui.candidateElements().filter(el => group.contains(el));
      for (const element of candidates) {
        const key = fields.projectField(ui.fieldContext(element), ui.sectionContext(element));
        if (!key || !ui.isEmpty(element)) continue;
        const raw = String(project[key] || "").trim();
        if (!raw) { skipped.push(`${project.project_name}：素材尚未填写“${fieldLabels[key]}”`); continue; }
        const value = fields.dateValue(raw, element.type);
        if (!value || (element.maxLength > 0 && value.length > element.maxLength)) {
          skipped.push(`${project.project_name}：日期格式或字数限制需手动处理`); continue;
        }
        if (ui.setNativeValue(element, value)) {
          await delay(40);
          if (String(element.value ?? element.textContent).trim() === value) filled.push(`${project.project_name} · ${fieldLabels[key]}`);
          else skipped.push(`${project.project_name}：网站未保留“${fieldLabels[key]}”的值`);
        } else skipped.push(`${project.project_name}：控件暂不支持“${fieldLabels[key]}”`);
      }
    }
    return { filled, skipped };
  }

  function fileFields() {
    return [...document.querySelectorAll("input[type='file']")].filter(el => !el.disabled).map((el, index) => ({
      index, label: ui.fieldContext(el).slice(0, 140) || `附件上传框 ${index + 1}`,
      accept: el.accept, occupied: el.files.length > 0
    }));
  }

  async function attach(message) {
    const inputs = [...document.querySelectorAll("input[type='file']")].filter(el => !el.disabled);
    const input = inputs[message.index];
    if (!input || (ui.fieldContext(input).slice(0, 140) || `附件上传框 ${message.index + 1}`) !== message.label) throw new Error("上传框已变化，请重新检查上传框");
    if (input.files.length) throw new Error("该上传框已有文件，请手动处理后再试");
    const file = message.file;
    if (!file || file.base64.length > 17 * 1024 * 1024) throw new Error("附件过大或无效");
    const extension = '.' + file.name.split('.').pop().toLowerCase();
    const accepted = input.accept.toLowerCase().split(',').map(item => item.trim()).filter(Boolean);
    if (accepted.length && !accepted.some(item => item === extension || item === file.mime || item === '*/*' || (item.endsWith('/*') && file.mime.startsWith(item.slice(0, -1))))) throw new Error(`网站要求 ${input.accept}，所选文件格式不匹配`);
    const bytes = Uint8Array.from(atob(file.base64), char => char.charCodeAt(0));
    const data = new DataTransfer();
    data.items.add(new File([bytes], file.name, { type: file.mime }));
    input.files = data.files;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return { message: `已将 ${file.name} 放入上传框并触发上传。请检查网站是否显示上传成功。` };
  }

  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id) return false;
    let task;
    if (message.type === "JOB_EXTRACT") task = Promise.resolve(extractJob());
    else if (message.type === "JOB_READ_LINKED_DETAIL") task = readLinkedJob();
    else if (message.type === "JOB_PROJECT_FILL") task = fillProjects(message.projects || []);
    else if (message.type === "JOB_FILE_FIELDS") task = Promise.resolve({ fields: fileFields() });
    else if (message.type === "JOB_ATTACH") task = attach(message);
    else return false;
    task.then(respond).catch(error => respond({ error: error.message }));
    return true;
  });
})();
