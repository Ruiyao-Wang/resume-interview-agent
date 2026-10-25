"use strict";
(() => {
  const core = globalThis.JobFormAutofillCore;
  const form = document.getElementById("personalForm");
  const status = document.getElementById("personalStatus");
  const save = document.getElementById("savePersonal");
  const add = document.getElementById("addEducation");
  let loaded = false;
  const sections = { basic: "personalBasic", sensitive: "personalSensitive", family: "personalFamily" };
  for (const definition of core.FIELD_DEFINITIONS) {
    if (!sections[definition.section]) continue;
    const label = document.createElement("label");
    label.textContent = definition.label;
    const input = document.createElement("input");
    input.name = definition.key;
    input.maxLength = 1000;
    input.autocomplete = "off";
    if (definition.key === "targetCity") {
      input.placeholder = "如：北京、南京、上海、郑州（按优先顺序）";
      input.title = "单选栏按顺序匹配一个可选城市，第二意向顺延且避免重复；只选择这里保存的城市。";
    }
    if (definition.key === "email") input.type = "email";
    if (definition.key === "heightCm" || definition.key === "weightKg") { input.type = "number"; input.min = "0"; input.step = "any"; }
    label.append(input);
    document.getElementById(sections[definition.section]).append(label);
  }
  function addEducation(data = {}, primary = false) {
    const container = document.getElementById("educationRecords");
    if (container.children.length >= 20) { status.textContent = "最多保存20段教育经历"; return; }
    const card = document.createElement("div");
    card.className = "card education-record";
    const primaryLabel = document.createElement("label");
    const radio = document.createElement("input");
    radio.type = "radio"; radio.name = "primaryEducation";
    radio.checked = primary || !container.children.length;
    primaryLabel.append(radio, " 设为默认教育经历");
    card.append(primaryLabel);
    const grid = document.createElement("div");
    grid.className = "profile-grid";
    for (const [key, labelText] of [["school", "学校"], ["major", "专业"], ["degree", "学历"], ["startDate", "入学时间"], ["graduationDate", "毕业时间"], ["studentId", "学号（选填）"]]) {
      const label = document.createElement("label");
      label.textContent = labelText;
      const input = document.createElement("input");
      input.dataset.educationKey = key;
      input.value = data[key] || "";
      input.maxLength = ["school", "major"].includes(key) ? 200 : ["startDate", "graduationDate"].includes(key) ? 30 : 80;
      if (key.endsWith("Date")) input.placeholder = "如：2025-09；请按真实时间填写";
      label.append(input); grid.append(label);
    }
    const remove = document.createElement("button");
    remove.type = "button"; remove.textContent = "移除这段（保存后生效）";
    remove.addEventListener("click", () => {
      card.remove();
      if (!container.querySelector(":checked")) { const first = container.querySelector("input[type=radio]"); if (first) first.checked = true; }
      status.textContent = "有未保存的修改";
    });
    card.append(grid, remove); container.append(card);
  }
  form.addEventListener("input", () => { if (loaded) status.textContent = "有未保存的修改"; });
  add.addEventListener("click", () => { addEducation(); status.textContent = "有未保存的修改"; });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (!loaded) return;
    save.disabled = true;
    const profile = {};
    for (const definition of core.FIELD_DEFINITIONS) if (sections[definition.section]) profile[definition.key] = form.elements.namedItem(definition.key).value.trim();
    const cards = [...document.querySelectorAll(".education-record")];
    const education = cards.map(card => Object.fromEntries([...card.querySelectorAll("[data-education-key]")].map(input => [input.dataset.educationKey, input.value.trim()])));
    const primary_education = Math.max(0, cards.findIndex(card => card.querySelector("input[type=radio]").checked));
    try {
      const response = await fetch("/api/profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ profile, education, primary_education }) });
      if (!response.ok) throw new Error("保存失败，请检查字段长度和后台连接");
      status.textContent = "已保存到本机后台，插件下次填写时会读取最新资料";
    } catch (error) { status.textContent = error.message; }
    finally { save.disabled = false; }
  });
  (async () => {
    const response = await fetch("/api/profile", { cache: "no-store" });
    if (!response.ok) throw new Error("个人资料加载失败，请重启新版后台后刷新页面");
    const data = await response.json();
    for (const [key, value] of Object.entries(data.profile || {})) {
      const input = form.elements.namedItem(key);
      if (input) input.value = value;
    }
    let education = data.education || [];
    if (!education.length && data.profile?.school) education = [data.profile];
    education.forEach((record, index) => addEducation(record, index === data.primary_education));
    loaded = true; save.disabled = false; add.disabled = false;
    status.textContent = "资料已加载";
  })().catch(error => { status.textContent = error.message; });
})();
