"use strict";

const fillSafe = document.getElementById("fillSafe");
const fillSensitive = document.getElementById("fillSensitive");
const openOptions = document.getElementById("openOptions");
const result = document.getElementById("result");

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("没有找到当前网页");
  return tab;
}

function renderResponse(response) {
  if (!response || response.error) {
    result.innerHTML = `<p class="error">${escapeHtml(response?.error || "无法读取当前页面")}</p>`;
    return;
  }
  const labels = response.filled.map((item) => item.label);
  const sensitiveLabels = [...new Set(response.sensitive.map((item) => item.label))];
  result.innerHTML = `
    <div class="summary">
      <strong>已填写 ${response.filled.length} 项</strong>
      ${labels.length ? `<ul>${labels.map((label) => `<li>${escapeHtml(label)}</li>`).join("")}</ul>` : "<p>没有发现可填写的空白普通字段。</p>"}
      ${sensitiveLabels.length ? `<p class="warning">发现敏感字段：${sensitiveLabels.map(escapeHtml).join("、")}。请检查页面后再确认。</p>` : ""}
      ${response.skipped.length ? `<p>跳过 ${response.skipped.length} 项。</p><ul>${response.skipped.filter(item => item.reason !== "字段已有内容").map(item => `<li>${escapeHtml(item.label)}：${escapeHtml(item.reason)}</li>`).join("")}</ul>` : ""}
      ${response.missing?.length ? `<p>已识别但后台尚未录入：${[...new Set(response.missing.map(item => item.label))].map(escapeHtml).join("、")}</p>` : ""}
    </div>`;
  fillSensitive.hidden = sensitiveLabels.length === 0;
}

async function latestProfile() {
  const data = await api("profile", {});
  const profile = { ...(data.profile || {}) };
  profile._educationRecords = Array.isArray(data.education) ? data.education : [];
  profile._primaryEducation = data.primary_education || 0;
  if (data.education?.length) {
    const education = data.education[data.primary_education || 0] || data.education[0];
    for (const key of ["school", "major", "degree", "startDate", "graduationDate", "studentId"]) profile[key] = education[key] || "";
  }
  return profile;
}

async function sendFill(includeSensitive, onlySensitive, profile) {
  result.textContent = "正在识别当前页面……";
  const tab = await activeTab();
  profile ||= await latestProfile();
  const response = await pageMessage({ type: "JOB_FORM_FILL", includeSensitive, onlySensitive, profile }, tab);
  renderResponse(response);
  return response;
}

fillSafe.addEventListener("click", () => sendFill(false, false).catch((error) => renderResponse({ error: error.message })));
fillSensitive.addEventListener("click", () => sendFill(true, true).catch((error) => renderResponse({ error: error.message })));
openOptions.addEventListener("click", () => chrome.tabs.create({ url: "http://127.0.0.1:8765/#personalSection" }));
document.getElementById("legacyOptions").addEventListener("click", () => chrome.runtime.openOptionsPage());

let materials = null;
let savedChoices = null;
let uploadFields = [];
let uploadTabId = null;
let jobSourceUrl = "";
const byId = id => document.getElementById(id);

async function pageMessage(message, tab) {
  tab ||= await activeTab();
  if (!/^https?:/.test(tab.url || "")) throw new Error("请在普通招聘网页或本地演示页上使用插件");
  let response;
  try { response = await chrome.tabs.sendMessage(tab.id, message); }
  catch (error) {
    // Existing tabs may predate installation/update. Inject once, guarded in each script.
    if (!/receiving end does not exist|could not establish connection/i.test(error.message)) throw error;
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["core.js", "project-fields.js", "page-context.js", "preference-values.js", "education-records.js", "select-controls.js", "content.js", "project-content.js"] });
    response = await chrome.tabs.sendMessage(tab.id, message);
  }
  if (!response) throw new Error("网页未响应，请刷新网页后重试");
  if (response.error) throw new Error(response.error);
  return response;
}

async function api(action, payload) {
  const response = await chrome.runtime.sendMessage({ type: "MATERIAL_API", action, ...payload });
  if (!response || response.error) throw new Error(response?.error || "后台未响应");
  return response.data;
}

function bindAction(id, fn) {
  byId(id).addEventListener("click", async () => {
    const button = byId(id);
    button.disabled = true;
    result.textContent = "正在处理……";
    try { await fn(); } catch (error) { result.textContent = error.message; }
    finally { button.disabled = false; }
  });
}

function renderMaterials() {
  if (!materials) return;
  const resumes = materials.resume_candidates || [];
  const projects = materials.project_candidates || [];
  byId("selection").innerHTML = `<p>用于：${escapeHtml(materials.job_title || "已保存的岗位")}（跳转申请页面后仍保留）</p>
    <label>简历附件<select id="resumeChoice"><option value="">暂不上传附件</option>${resumes.map((item, index) => `<option value="${index}" ${index === 0 && item.score > 0 ? "selected" : ""}>${escapeHtml(item.name)} · 关键词分 ${item.score}</option>`).join("")}</select></label>
    <p>选择要填入的项目（最多6个）：</p>${projects.map((project, index) => `<div class="project-card"><label><input type="checkbox" class="projectChoice" value="${index}" ${index < 3 && project.score > 0 ? "checked" : ""}/> ${escapeHtml(project.project_name)}</label><select class="variantChoice" data-index="${index}" aria-label="${escapeHtml(project.project_name)}的表述版本">${(project.variants || [project]).map((variant, vi) => `<option value="${vi}">${escapeHtml(variant.variant_name)}${vi === 0 ? "（推荐）" : ""}</option>`).join("")}</select><details><summary>查看所选内容与匹配词</summary><p class="variantKeywords"></p><pre class="variantPreview"></pre></details></div>`).join("") || "请先在素材库添加项目表述"}
    <p class="hint">关键词分仅用于排序，不是录取概率。可以取消项目、修改附件选择。</p>`;
  byId("fillProjects").disabled = !projects.length;
  byId("scanUpload").disabled = !resumes.length;
  byId("uploadSection").hidden = true;
  if (savedChoices) {
    byId("resumeChoice").value = savedChoices.resume;
    document.querySelectorAll(".projectChoice").forEach(el => { el.checked = (savedChoices.projects || []).includes(el.value); });
    document.querySelectorAll(".variantChoice").forEach(el => {
      const value = String(savedChoices.variants?.[el.dataset.index] ?? "0");
      el.value = [...el.options].some(option => option.value === value) ? value : "0";
    });
  }
  updateVariantPreviews();
}

function chosenProject(index) {
  const project = materials.project_candidates[index];
  const choice = document.querySelector(`.variantChoice[data-index="${index}"]`)?.value || "0";
  return (project.variants || [project])[Number(choice)] || project;
}

function updateVariantPreviews() {
  document.querySelectorAll(".project-card").forEach((card, index) => {
    const project = chosenProject(index);
    card.querySelector(".variantKeywords").textContent = (project.matched_keywords || []).join("、") || "未命中关键词，可自行判断是否使用";
    card.querySelector(".variantPreview").textContent = [
      project.start_date || project.end_date ? `时间：${project.start_date || "未填"} — ${project.end_date || "未填"}` : "",
      project.role ? `角色：${project.role}` : "",
      project.responsibilities ? `职责：${project.responsibilities}` : "",
      `项目描述：${project.content || ""}`
    ].filter(Boolean).join("\n");
  });
}

byId("selection").addEventListener("change", async () => {
  updateVariantPreviews();
  savedChoices = { resume: byId("resumeChoice").value, projects: [...document.querySelectorAll(".projectChoice:checked")].map(el => el.value), variants: Object.fromEntries([...document.querySelectorAll(".variantChoice")].map(el => [el.dataset.index, el.value])) };
  await chrome.storage.local.set({ materialChoices: savedChoices });
});
for (const id of ["jobTitle", "jobText"]) byId(id).addEventListener("change", () => chrome.storage.local.set({ jobDraft: { title: byId("jobTitle").value, text: byId("jobText").value } }));

bindAction("openLibrary", async () => {
  await chrome.tabs.create({ url: "http://127.0.0.1:8765" });
});
bindAction("extractJob", async () => {
  const job = await pageMessage({ type: "JOB_EXTRACT" });
  byId("jobTitle").value = job.title;
  byId("jobText").value = job.text;
  byId("jobEditor").open = true;
  jobSourceUrl = job.url;
  await chrome.storage.local.set({ jobDraft: job });
  result.textContent = "已读取，请核对岗位职责与要求，删除导航等无关内容，再点击推荐。也可以先在网页选中岗位正文再读取。";
});
bindAction("matchJob", async () => {
  const job = { title: byId("jobTitle").value.trim(), text: byId("jobText").value.trim(), url: jobSourceUrl };
  if (!job.text) throw new Error("请先读取岗位或粘贴岗位要求");
  materials = await api("match", { payload: { job_title: job.title, job_description: job.text, max_projects: 6 } });
  materials.source_url = job.url;
  materials.saved_at = Date.now();
  savedChoices = null;
  await chrome.storage.local.set({ jobMaterials: materials, jobDraft: job, materialChoices: null });
  renderMaterials();
  result.textContent = "推荐已保存。进入这个岗位的申请表，再打开插件点击③。";
});
bindAction("fillProjects", async () => {
  const projects = [...document.querySelectorAll(".projectChoice:checked")].map(el => chosenProject(Number(el.value)));
  if (!projects.length) throw new Error("请至少选择一个项目");
  if (projects.length > 6) throw new Error("一次最多选择6个项目，请减少勾选");
  const response = await pageMessage({ type: "JOB_PROJECT_FILL", projects });
  result.innerHTML = `<p>已填写 ${response.filled.length} 个项目字段。</p>${response.skipped.length ? `<ul>${response.skipped.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : "<p>请核对网页上的绿色字段。</p>"}`;
});
bindAction("scanUpload", async () => {
  const tab = await activeTab();
  const response = await pageMessage({ type: "JOB_FILE_FIELDS" }, tab);
  uploadTabId = tab.id;
  uploadFields = response.fields;
  byId("uploadSection").hidden = !uploadFields.length;
  byId("uploadTarget").innerHTML = `<option value="">请选择简历上传框</option>` + uploadFields.map((field, index) => `<option value="${index}" ${field.occupied ? "disabled" : ""}>${escapeHtml(field.label)} ${field.occupied ? "（已有文件）" : ""}</option>`).join("");
  const resumeFields = uploadFields.filter(field => /简历|resume|\bcv\b/i.test(field.label) && !field.occupied && !/照片|头像|证件|photo/i.test(field.label));
  if (resumeFields.length === 1) byId("uploadTarget").value = String(uploadFields.indexOf(resumeFields[0]));
  result.textContent = uploadFields.length ? "请选择简历附件框，再点击上传。" : "当前页没有发现附件控件，请先在网站打开上传区域。";
});
bindAction("attachResume", async () => {
  const selected = byId("resumeChoice")?.value;
  if (!selected) throw new Error("请先选择要上传的简历附件");
  const target = byId("uploadTarget").value;
  if (target === "") throw new Error("请选择正确的简历上传框");
  const tab = await activeTab();
  if (tab.id !== uploadTabId) throw new Error("当前网页已改变，请重新检查上传框");
  const resume = materials.resume_candidates[Number(selected)];
  const file = await api("attachment", { id: resume.id });
  const field = uploadFields[Number(target)];
  const response = await pageMessage({ type: "JOB_ATTACH", file, index: field.index, label: field.label }, tab);
  result.textContent = response.message;
});

function sameJobSite(first, second) {
  try {
    const a = new URL(first), b = new URL(second);
    const tenant = url => url.pathname.match(/\/SU[a-z0-9]+/i)?.[0] || "";
    return a.origin === b.origin && tenant(a) === tenant(b);
  } catch { return false; }
}

bindAction("smartFill", async () => {
  const tab = await activeTab();
  let job = await pageMessage({ type: "JOB_EXTRACT" }, tab);
  if (job.ambiguousJobs) {
    result.textContent = "当前页包含多个岗位，请先打开要投递的具体岗位详情，再点智能填写。个人资料仍可用“填写普通字段”单独处理。";
    return;
  }
  if (!job.isJobDetail && job.isApplication) {
    const linked = await pageMessage({ type: "JOB_READ_LINKED_DETAIL" }, tab);
    if (linked.found) job = { ...job, ...linked.job, isApplication: true };
  }
  const report = [];
  if (job.isJobDetail) {
    const unchanged = materials && materials.job_text === job.text && sameJobSite(materials.source_url, job.url);
    if (!unchanged) {
      materials = await api("match", { payload: { job_title: job.title, job_description: job.text, max_projects: 6 } });
      Object.assign(materials, { source_url: job.url, job_text: job.text, saved_at: Date.now() });
      savedChoices = null;
      jobSourceUrl = job.url;
      byId("jobTitle").value = job.title;
      byId("jobText").value = job.text;
      await chrome.storage.local.set({ jobMaterials: materials, materialChoices: null, jobDraft: job });
      renderMaterials();
    }
    report.push(`已识别并选择材料：${materials.job_title}`);
  }
  if (!job.isApplication) {
    result.textContent = job.isJobDetail ? `${report.join("\n")}。进入该岗位的申请表，再点击“智能填写当前页面”即可。` : `当前页有 ${job.fieldCount || 0} 个可操作字段，尚不足以判断是申请表。可以点击“填写普通字段”独立处理已识别的个人资料；隐藏字段需先在网站展开。`;
    return;
  }
  const personal = await pageMessage({ type: "JOB_FORM_FILL", includeSensitive: false, onlySensitive: false, profile: await latestProfile() }, tab);
  fillSensitive.hidden = !personal.sensitive.length;
  report.push(`个人信息已填写 ${personal.filled.length} 项`);
  if (personal.missing?.length) report.push(`已识别但后台尚未录入：${[...new Set(personal.missing.map(item => item.label))].join("、")}`);
  const personalIssues = personal.skipped.filter(item => item.reason !== "字段已有内容");
  report.push(...personalIssues.map(item => `${item.label}：${item.reason}`));
  if (personal.sensitive.length) report.push("页面有敏感个人字段，可另点“确认填写敏感字段”");
  const usableJob = materials && sameJobSite(materials.source_url, tab.url) && (job.isJobDetail || Date.now() - (materials.saved_at || 0) < 2 * 60 * 60 * 1000);
  if (!usableJob) {
    report.push("已先处理当前表单的个人资料。项目与附件还缺少对应岗位信息：打开该岗位详情点一次智能填写，再回来即可，不需要复制粘贴。");
    result.textContent = report.join("\n"); return;
  }
  report.push(`使用岗位材料：${materials.job_title}`);
  const selected = [...document.querySelectorAll(".projectChoice:checked")].map(el => chosenProject(Number(el.value)));
  if (selected.length > 6) throw new Error("一次最多选择6个项目，请减少勾选");
  if (selected.length) {
    const response = await pageMessage({ type: "JOB_PROJECT_FILL", projects: selected }, tab);
    report.push(`项目已填写 ${response.filled.length} 个字段`, ...response.skipped);
  } else report.push("没有选中的项目，请先在素材库录入项目表述，或手动勾选。");
  const resumeIndex = byId("resumeChoice")?.value;
  if (resumeIndex !== undefined && resumeIndex !== "") {
    const { fields } = await pageMessage({ type: "JOB_FILE_FIELDS" }, tab);
    const targets = fields.filter(field => /简历|resume|\bcv\b/i.test(field.label) && !/照片|头像|证件|photo/i.test(field.label));
    if (targets.length === 1 && !targets[0].occupied) {
      try {
        const file = await api("attachment", { id: materials.resume_candidates[Number(resumeIndex)].id });
        const response = await pageMessage({ type: "JOB_ATTACH", file, index: targets[0].index, label: targets[0].label }, tab);
        report.push(response.message);
      } catch (error) { report.push(`个人与项目填写已完成，附件未完成：${error.message}`); }
    } else report.push(targets.length === 1 && targets[0].occupied ? "简历框已有文件，已保留" : "简历上传框无法唯一确定，可使用④选择正确的框");
  }
  result.textContent = report.join("\n");
});
(async () => {
  const state = await chrome.storage.local.get(["jobDraft", "jobMaterials", "materialChoices"]);
  byId("jobTitle").value = state.jobDraft?.title || "";
  byId("jobText").value = state.jobDraft?.text || "";
  jobSourceUrl = state.jobDraft?.url || "";
  materials = state.jobMaterials;
  savedChoices = state.materialChoices;
  renderMaterials();
})().catch(error => { result.textContent = error.message; });
