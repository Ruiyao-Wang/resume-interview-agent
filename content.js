(function () {
  "use strict";

  const core = globalThis.JobFormAutofillCore;
  if (!core || globalThis.JobFormContent) return;

  function visible(element) {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  }

  function captionText(node) {
    if (!node) return "";
    const copy = node.cloneNode(true);
    copy.querySelectorAll("input, textarea, select, [contenteditable], [role='option'], script, style, .ant-select-dropdown, .el-select-dropdown").forEach(el => el.remove());
    return String(copy.textContent || "").replace(/\s+/g, " ").trim().slice(0, 160);
  }

  function sectionContext(element) {
    let parent = element.parentElement;
    for (let depth = 0; parent && parent !== document.body && depth < 6; depth++, parent = parent.parentElement) {
      const heading = parent.querySelector(":scope > legend, :scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > header > h2, :scope > [role='heading']");
      if (heading && captionText(heading).length < 80) return captionText(heading);
    }
    return "";
  }

  function fieldContext(element) {
    const parts = [
      element.getAttribute("aria-label"),
      element.getAttribute("placeholder"),
      element.getAttribute("name"),
      element.getAttribute("id"),
      element.getAttribute("data-label"),
      element.getAttribute("autocomplete")
    ];
    for (const id of (element.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean)) parts.push(captionText(document.getElementById(id)));
    if (element.id) {
      const escaped = globalThis.CSS?.escape ? CSS.escape(element.id) : element.id.replace(/"/g, "\\\"");
      document.querySelectorAll(`label[for="${escaped}"]`).forEach((label) => parts.push(captionText(label)));
    }
    const wrappingLabel = element.closest("label");
    if (wrappingLabel) parts.push(captionText(wrappingLabel));
    const nearby = element.closest(".form-item, .form-group, .ant-form-item, .el-form-item, [class*='field'], [class*='formItem']");
    if (nearby && nearby.querySelectorAll("input:not([type=hidden]), textarea, select").length <= 1) parts.push(captionText(nearby));
    if (!wrappingLabel && !element.labels?.length && !nearby) {
      const previous = element.previousElementSibling || element.parentElement?.previousElementSibling;
      if (previous && !previous.querySelector("input, textarea, select") && previous.innerText?.length < 45) parts.push(previous.innerText);
    }
    if (!wrappingLabel && !element.labels?.length) {
      let parent = element.parentElement;
      for (let depth = 0; parent && parent !== document.body && depth < 3; depth++, parent = parent.parentElement) {
        if (parent.querySelectorAll("input:not([type=hidden]), textarea, select").length > 1) break;
        const text = captionText(parent);
        if (text && text.length <= 90) { parts.push(text); break; }
      }
    }
    return parts.filter(Boolean).join(" ");
  }

  function candidateElements() {
    return [...document.querySelectorAll("input, textarea, select, [contenteditable='true'], [role='combobox']")].filter((element) => {
      const type = String(element.getAttribute("type") || "").toLowerCase();
      if (element.matches("[role='combobox']:not(input)") && [...element.querySelectorAll("input")].some(visible)) return false;
      return visible(element) && !element.disabled && element.getAttribute("aria-disabled") !== "true" && (!element.readOnly || globalThis.JobSelectControls?.isCombo(element)) && !["hidden", "password", "submit", "button", "reset", "file", "checkbox", "radio"].includes(type);
    });
  }

  function isEmpty(element) {
    if (element.tagName === "SELECT" || globalThis.JobSelectControls?.isCombo(element)) return globalThis.JobSelectControls?.empty(element) ?? !element.value;
    if (element.matches("[contenteditable='true']")) return !String(element.innerText || "").trim();
    return !String(element.value || "").trim();
  }

  function setNativeValue(element, value, mark = true) {
    if (element.tagName === "SELECT") {
      const wanted = core.normalize(value);
      const option = [...element.options].find((item) => {
        const text = core.normalize(item.textContent);
        const optionValue = core.normalize(item.value);
        return item.value && text && (text === wanted || optionValue === wanted);
      });
      if (!option) return false;
      element.value = option.value;
    } else if (element.matches("[contenteditable='true']")) {
      element.focus();
      element.textContent = value;
    } else {
      const prototype = element.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
      if (setter) setter.call(element, value);
      else element.value = value;
    }
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    if (mark) { element.style.outline = "2px solid #2f7d32"; element.dataset.jobAutofillFilled = "true"; }
    return true;
  }

  globalThis.JobFormContent = { visible, fieldContext, sectionContext, captionText, candidateElements, isEmpty, setNativeValue };

  function scan(profile) {
    const matches = [];
    for (const element of candidateElements()) {
      let context = fieldContext(element);
      let match = core.matchField(context, element.type);
      // A technical id such as degree-school must not defeat a clear visible 毕业院校 label.
      // Limit this fallback to unambiguous education captions; retain all name/contact guards.
      {
        const captions = [element.getAttribute("aria-label"), ...[...(element.labels || [])].map(captionText), ...(element.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean).map(id => captionText(document.getElementById(id)))].filter(Boolean).join(" ");
        const specific = core.matchField(captions, element.type);
        if (specific?.definition.section === "education") { match = specific; context = captions; }
      }
      if (!match || match.score < 55) continue;
      const { definition } = match;
      matches.push({ element, context, definition, score: match.score, empty: isEmpty(element) });
    }
    return matches;
  }

  async function handleFill(message) {
    const stored = await chrome.storage.local.get("profile");
    const profile = { ...core.DEFAULT_PROFILE, ...(message.profile || stored.profile || {}) };
    const matches = scan(profile);
    const educationPlan = globalThis.JobEducationRecords?.plan(matches, profile, globalThis.JobFormContent) || new Map();
    const preference = globalThis.JobPreferenceValues;
    const cityFields = matches.filter(match => match.definition.key === "targetCity");
    const rank = match => preference?.detectPreferenceIndex(match.context, cityFields.indexOf(match)) || 0;
    // Only repair an old plugin-generated comma-list search; never replace a user's actual choice.
    const repairableCity = match => match.definition.key === "targetCity" && match.element.dataset.jobAutofillFilled === "true" && preference?.parseOrderedValues(match.element.value).length > 1 && String(match.element.value).trim() === String(profile.targetCity).trim();
    const chosenCities = cityFields.filter(match => !match.empty && !repairableCity(match)).flatMap(match => preference?.parseOrderedValues(globalThis.JobSelectControls.selectedText(match.element)) || []);
    const orderedMatches = [...matches.filter(match => match.definition.key !== "targetCity"), ...cityFields.slice().sort((a, b) => rank(a) - rank(b))];
    const filled = [];
    const sensitive = [];
    const skipped = [];
    const missing = [];

    for (const match of orderedMatches) {
      const item = { key: match.definition.key, label: match.definition.label, context: match.context.slice(0, 90) };
      const education = educationPlan.get(match);
      const savedValue = education ? education.value : profile[match.definition.key];
      if (education?.reason) {
        skipped.push({ ...item, reason: education.reason });
        continue;
      }
      if (!String(savedValue || "").trim()) {
        if (match.empty) missing.push(item);
        continue;
      }
      if (!match.empty && !repairableCity(match)) {
        skipped.push({ ...item, reason: "字段已有内容" });
        continue;
      }
      if (match.definition.sensitive && !message.includeSensitive) {
        sensitive.push(item);
        continue;
      }
      if (message.onlySensitive && !match.definition.sensitive) continue;
      let outcome;
      try {
        if (!match.element.isConnected) { skipped.push({ ...item, reason: "网站已重新加载此栏，请再点一次填写" }); continue; }
        let value = String(savedValue);
        const config = { key: item.key, context: match.context };
        if (item.key === "targetCity" && preference) {
          config.candidates = preference.getCityCandidates(value, { fieldContext: match.context, index: cityFields.indexOf(match), chosen: chosenCities });
          if (!config.candidates.length) { skipped.push({ ...item, reason: "没有剩余的已保存意向城市，请补充意向，未随机选择" }); continue; }
          value = config.candidates[0];
          if (repairableCity(match)) { setNativeValue(match.element, "", false); delete match.element.dataset.jobAutofillFilled; match.element.style.outline = ""; }
        }
        if (["startDate", "graduationDate", "birthDate"].includes(match.definition.key)) {
          if (/(?:年份|\byear\b)/i.test(match.context) && !/(?:月份|年月|\bmonth\b)/i.test(match.context)) value = value.match(/^\d{4}(?=$|[-/.年])/)?.[0] || "";
          else value = globalThis.JobProjectFields.dateValue(value, match.element.type);
        }
        if (item.key === "degree") value = globalThis.JobEducationRecords?.valueAliases(item.key, value, match.context)[0] || value;
        if (!value || match.element.maxLength > 0 && value.length > match.element.maxLength) {
          skipped.push({ ...item, reason: "网站要求的日期精度或字数与已存资料不同，需要补充完整信息" }); continue;
        }
        if (match.element.tagName === "SELECT" || globalThis.JobSelectControls?.isCombo(match.element)) {
          outcome = await globalThis.JobSelectControls.fill(match.element, value, globalThis.JobFormContent, config);
        } else {
          setNativeValue(match.element, value, false);
          await new Promise(resolve => setTimeout(resolve, 60));
          outcome = { ok: String(match.element.value ?? match.element.textContent).trim() === value.trim(), reason: "网站未保留输入结果，可能需要选择建议项或补齐日期" };
        }
        if (item.key === "targetCity" && outcome.ok) chosenCities.push(outcome.selectedValue || value);
      } catch { outcome = { ok: false, reason: "控件在操作时发生变化，请重试或展开对应列表后填写" }; }
      if (outcome.ok) { match.element.style.outline = "2px solid #2f7d32"; match.element.dataset.jobAutofillFilled = "true"; }
      (outcome.ok ? filled : skipped).push(outcome.ok ? item : { ...item, reason: outcome.reason || "控件不支持自动填写" });
    }

    return { filled, sensitive, skipped, missing, recognized: matches.length, total: candidateElements().length, page: { title: document.title, url: location.href } };
  }

  let filling = false;
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== "JOB_FORM_FILL") return false;
    if (filling) { sendResponse({ error: "正在逐项选择，请等本次填写完成后再点" }); return false; }
    filling = true;
    handleFill(message).then(sendResponse).catch((error) => sendResponse({ error: error.message })).finally(() => { filling = false; });
    return true;
  });
})();
