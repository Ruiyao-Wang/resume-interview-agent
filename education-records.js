(function (root) {
  "use strict";

  const KEYS = new Set(["school", "major", "degree", "startDate", "graduationDate", "studentId"]);
  const normalize = value => String(value || "").normalize("NFKC").toLowerCase().replace(/[\s‘’'"。.]/g, "");

  function degreeKind(value) {
    const text = String(value || "").normalize("NFKC").toLowerCase();
    const kinds = [
      ["doctor", /博士|\bph\.?d\b|\bdoctor(?:al|ate)?\b/],
      ["master", /硕士|\bmaster(?:['’]s)?\b/],
      ["bachelor", /本科|学士|\bbachelor(?:['’]s)?\b|\bundergraduate\b/],
      ["associate", /大专|专科|\bassociate(?:['’]s)?\b/]
    ].filter(([, pattern]) => pattern.test(text)).map(([kind]) => kind);
    return kinds.length === 1 ? kinds[0] : "";
  }

  function valueAliases(key, value, context = "") {
    const original = String(value || "").trim();
    if (!original || key !== "degree") return original ? [original] : [];
    const kind = degreeKind(original);
    if (!kind) return [original];
    const credential = /学位/.test(context) && !/学历/.test(context);
    const aliases = {
      bachelor: credential
        ? ["学士", "学士学位", "Bachelor", "Bachelor's", "Bachelor's degree", "Bachelors"]
        : ["本科", "大学本科", "本科学历", "Bachelor", "Bachelor's", "Bachelor's degree", "Bachelors", "Undergraduate"],
      master: credential
        ? ["硕士", "硕士学位", "Master", "Master's", "Master's degree", "Masters"]
        : ["硕士研究生", "硕士", "研究生（硕士）", "Master", "Master's", "Master's degree", "Masters"],
      doctor: credential
        ? ["博士", "博士学位", "PhD", "Ph.D.", "Doctorate", "Doctoral"]
        : ["博士研究生", "博士", "研究生（博士）", "PhD", "Ph.D.", "Doctorate", "Doctoral"],
      associate: ["大专", "专科", "大学专科", "Associate", "Associate's degree"]
    }[kind];
    // A generic “研究生” option cannot distinguish a master's from a doctorate.
    // Never map a school/major to a different label merely because it looks similar.
    return [...new Set(credential ? aliases : [original, ...aliases])];
  }

  function readValue(match) {
    const element = match.element;
    if (element.tagName === "SELECT") return String(element.selectedOptions?.[0]?.textContent || element.value || "").trim();
    const marker = element.closest?.(".ant-select, .el-select, .select2-container, [role='combobox']")?.querySelector?.(".ant-select-selection-item, .el-select__selected-item:not(.is-placeholder), .select2-selection__rendered[title]");
    return String(marker?.getAttribute?.("title") || marker?.textContent || element.value || element.textContent || "").trim();
  }

  function slotKey(match) {
    // One record commonly contains both 学历 and 学位. They are not two records.
    return match.definition.key === "degree" && /学位/.test(match.context || "") && !/学历/.test(match.context || "")
      ? "academicDegree" : match.definition.key;
  }

  function scopeFor(match, matches) {
    let scope = null;
    for (let node = match.element.parentElement, depth = 0; node && !["BODY", "HTML"].includes(node.tagName) && depth < 12; node = node.parentElement, depth++) {
      const inside = matches.filter(other => node.contains(other.element));
      const keys = inside.map(slotKey);
      if (new Set(keys).size < keys.length) break;
      const explicitCard = node.matches?.("fieldset, .education-record, .education-card, [data-education-record]");
      if (inside.length >= 2 || explicitCard) scope = node;
    }
    return scope;
  }

  function recordOrder(records) {
    const timestamp = record => {
      const value = String(record.startDate || record.graduationDate || "");
      const found = value.match(/^(\d{4})(?:[-/.年](\d{1,2}))?/);
      return found ? Number(found[1]) * 12 + Number(found[2] || 0) : 0;
    };
    const rank = { doctor: 4, master: 3, bachelor: 2, associate: 1 };
    return [...records].sort((a, b) => timestamp(b.record) - timestamp(a.record)
      || (rank[degreeKind(b.record.degree)] || 0) - (rank[degreeKind(a.record.degree)] || 0)
      || a.index - b.index);
  }

  function plan(matches, profile, ui = {}) {
    const education = matches.filter(match => KEYS.has(match.definition.key));
    const result = new Map();
    if (!education.length) return result;
    const stored = Array.isArray(profile._educationRecords) && profile._educationRecords.length ? profile._educationRecords : [profile];
    const records = stored.map((record, index) => ({ record, index })).filter(item => item.record && typeof item.record === "object");
    const primary = records.find(item => item.index === Number(profile._primaryEducation || 0)) || records[0];
    const scopes = new Map();
    for (const match of education) {
      const scope = scopeFor(match, education);
      const key = scope || match;
      if (!scopes.has(key)) scopes.set(key, { matches: [], scope });
      scopes.get(key).matches.push(match);
    }
    let groups = [...scopes.values()];
    const repeatedKeys = education.some(match => education.filter(other => slotKey(other) === slotKey(match)).length > 1);
    // A single unwrapped school field (or separate, non-repeated education fields)
    // still belongs to the default record, even without a framework-specific card.
    if (!repeatedKeys) groups = [{ matches: education, scope: null }];
    const allClear = groups.every(group => group.scope);
    const used = new Set();
    const pending = [];

    function assign(group, chosen, reason = "") {
      for (const match of group.matches) {
        const key = match.definition.key;
        result.set(match, {
          value: chosen ? String(chosen.record[key] || "") : "",
          recordIndex: chosen?.index ?? null,
          ...(reason ? { reason } : {})
        });
      }
      if (chosen) used.add(chosen.index);
    }

    for (const group of groups) {
      let candidates = records;
      let hasEvidence = false;
      const headings = [...new Set(group.matches.map(match => ui.sectionContext?.(match.element) || ""))];
      const kinds = [...new Set(headings.filter(text => !/及以上|以上学历|要求/.test(text)).map(degreeKind).filter(Boolean))];
      if (kinds.length > 1) { assign(group, null, "教育栏目同时包含多种学历，无法确定对应经历"); continue; }
      if (kinds.length === 1) {
        candidates = candidates.filter(item => degreeKind(item.record.degree) === kinds[0]);
        hasEvidence = true;
      }
      for (const match of group.matches.filter(item => !item.empty && ["school", "degree"].includes(item.definition.key))) {
        const existing = readValue(match);
        if (!existing) continue;
        hasEvidence = true;
        if (match.definition.key === "school") candidates = candidates.filter(item => normalize(item.record.school) === normalize(existing));
        else {
          const kind = degreeKind(existing);
          candidates = candidates.filter(item => kind ? degreeKind(item.record.degree) === kind : normalize(item.record.degree) === normalize(existing));
        }
      }
      if (hasEvidence) {
        if (candidates.length !== 1) assign(group, null, candidates.length ? "同一学校或学历对应多段资料，请确认本栏使用哪段" : "本栏学历或已有学校与保存的教育经历不一致，已保留原内容");
        else if (used.has(candidates[0].index)) assign(group, null, "多个教育栏目指向同一段经历，请核对栏目对应关系");
        else assign(group, candidates[0]);
      } else pending.push(group);
    }
    for (const group of pending) {
      if (groups.length === 1) { assign(group, primary); continue; }
      if (!allClear) { assign(group, null, "无法确认多段教育栏目的边界，请展开每段教育经历后重试"); continue; }
      const available = recordOrder(records).find(item => !used.has(item.index));
      if (!available) assign(group, null, "没有可对应的另一段教育经历，请先补充资料或核对栏目");
      else assign(group, available);
    }
    return result;
  }

  const api = { plan, valueAliases, degreeKind };
  root.JobEducationRecords = api;
  if (typeof module !== "undefined") module.exports = api;
})(globalThis);
