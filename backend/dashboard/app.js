"use strict";

const message = document.getElementById("message");
let library = { resumes: [], projects: [] };
let editingResumeId = null;
const tagHtml = (tags = []) => tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("");
const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
const splitTags = (value) => value.split(/[,，、;；|\n]+/).map((item) => item.trim()).filter(Boolean);

function toast(text) {
  message.textContent = text;
  message.style.display = "block";
  setTimeout(() => { message.style.display = "none"; }, 1800);
}

async function json(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

async function refresh() {
  const [resumes, projects] = await Promise.all([json("/api/resumes"), json("/api/projects")]);
  library = { resumes, projects };
  document.getElementById("resumeList").innerHTML = resumes.map((item, index) => `<div class="card"><strong>${escapeHtml(item.name)}</strong><div>${tagHtml(item.tags)}</div><small>${escapeHtml(item.original_filename)}</small><p>${escapeHtml(item.description)}</p><button type="button" data-resume="${index}">编辑名称与标签</button></div>`).join("") || "<p>尚未上传简历。</p>";
  document.getElementById("projectList").innerHTML = projects.map((item, index) => `<div class="card"><strong>${escapeHtml(item.name)}</strong><div>${tagHtml(item.tags)}</div><div class="variant-actions">${item.variants.map((variant, vi) => `<button type="button" data-project="${index}" data-variant="${vi}">编辑 ${escapeHtml(variant.name)}</button>`).join("")}</div></div>`).join("") || "<p>尚未添加项目。</p>";
}

document.getElementById("resumeList").addEventListener("click", event => {
  const button = event.target.closest("button[data-resume]");
  if (!button) return;
  const resume = library.resumes[Number(button.dataset.resume)];
  editingResumeId = resume.id;
  const form = document.getElementById("resumeEditForm");
  for (const key of ["name", "description"]) form.elements.namedItem(key).value = resume[key] || "";
  form.elements.namedItem("tags").value = resume.tags.join(", ");
  form.hidden = false;
  form.scrollIntoView({ behavior: "smooth", block: "center" });
});
document.getElementById("cancelResumeEdit").addEventListener("click", () => {
  editingResumeId = null;
  document.getElementById("resumeEditForm").hidden = true;
});
document.getElementById("resumeEditForm").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  try {
    await json(`/api/resumes/${editingResumeId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: data.get("name"), description: data.get("description"), tags: splitTags(data.get("tags") || "") }) });
    form.hidden = true;
    editingResumeId = null;
    await refresh();
    toast("简历标签已更新；请在插件中重新推荐以使用最新材料");
  } catch (error) { alert(error.message); }
});
document.getElementById("projectList").addEventListener("click", event => {
  const button = event.target.closest("button[data-project]");
  if (!button) return;
  const project = library.projects[Number(button.dataset.project)];
  const variant = project.variants[Number(button.dataset.variant)];
  const form = document.getElementById("projectForm");
  const values = { ...variant, project_name: project.name, variant_name: variant.name, project_tags: project.tags.join(", "), variant_tags: variant.tags.join(", ") };
  for (const input of form.querySelectorAll("input, textarea")) input.value = values[input.name] || "";
  form.elements.namedItem("project_name").readOnly = true;
  form.elements.namedItem("variant_name").readOnly = true;
  document.getElementById("copyProject").hidden = false;
  document.getElementById("projectEditHint").textContent = `正在编辑：${project.name} · ${variant.name}。保存将更新这个版本。`;
  form.scrollIntoView({ behavior: "smooth", block: "start" });
});
document.getElementById("newProject").addEventListener("click", () => {
  const form = document.getElementById("projectForm");
  form.reset();
  form.elements.namedItem("project_name").readOnly = false;
  form.elements.namedItem("variant_name").readOnly = false;
  document.getElementById("copyProject").hidden = true;
  document.getElementById("projectEditHint").textContent = "正在录入新项目；已有同名表述会被更新。";
});
document.getElementById("copyProject").addEventListener("click", () => {
  const input = document.getElementById("projectForm").elements.namedItem("variant_name");
  input.readOnly = false;
  input.value = "";
  input.focus();
  document.getElementById("projectEditHint").textContent = "请输入一个新的表述名称，再修改内容并保存。原版本会保留。";
});

document.getElementById("resumeForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    await json("/api/resumes", { method: "POST", body: new FormData(form) });
    form.reset();
    toast("简历版本已保存");
    await refresh();
  } catch (error) { alert(error.message); }
});

document.getElementById("projectForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const payload = {
    project_name: data.get("project_name"), category: "项目经历",
    project_tags: splitTags(data.get("project_tags") || ""),
    variant_name: data.get("variant_name"), variant_tags: splitTags(data.get("variant_tags") || ""),
    content: data.get("content"),
    ...Object.fromEntries(["start_date", "end_date", "role", "organization", "responsibilities"].map(key => [key, data.get(key) || ""]))
  };
  try {
    await json("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    toast("项目表述已保存；请在插件中重新推荐以使用最新内容");
    await refresh();
  } catch (error) { alert(error.message); }
});

document.getElementById("matchForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  try {
    const result = await json("/api/match", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ job_title: data.get("job_title"), job_description: data.get("job_description"), max_projects: 3 }) });
    const resume = result.recommended_resume;
    document.getElementById("matchResult").innerHTML = `<div class="card"><h3>推荐简历</h3>${resume ? `<strong>${escapeHtml(resume.name)}</strong> <span class="score">${resume.score}分</span><div>${tagHtml(resume.matched_keywords)}</div>` : "尚无简历版本"}<h3>推荐项目组合</h3>${result.recommended_projects.map((project) => `<div class="card"><strong>${escapeHtml(project.project_name)} · ${escapeHtml(project.variant_name)}</strong> <span class="score">${project.score}分</span><div>${tagHtml(project.matched_keywords)}</div><p>${escapeHtml(project.content)}</p></div>`).join("") || "尚无项目素材"}</div>`;
  } catch (error) { alert(error.message); }
});

refresh().catch((error) => alert(`后台连接失败：${error.message}`));
