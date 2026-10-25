(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.JobPreferenceValues = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Only spelling-level normalization is permitted. For example, 北京市 can
  // match 北京, but 南京 must never match 南宁 or a parent province.
  function normalizeCity(value) {
    if (typeof value !== "string") return "";
    return value.normalize("NFKC").trim().toLowerCase()
      .replace(/\s+/g, "").replace(/市$/, "");
  }

  function cityEquals(left, right) {
    const normalized = normalizeCity(left);
    return Boolean(normalized) && normalized === normalizeCity(right);
  }

  function parseOrderedValues(value) {
    const result = [];
    const seen = new Set();
    const append = item => {
      if (Array.isArray(item)) {
        item.forEach(append);
        return;
      }
      if (typeof item !== "string") return;
      for (const part of item.normalize("NFKC").split(/[,，、;；|｜\r\n]+/)) {
        const label = part.trim();
        const key = normalizeCity(label);
        if (key && !seen.has(key)) {
          seen.add(key);
          result.push(label);
        }
      }
    };
    append(value);
    return result;
  }

  function chineseNumber(value) {
    if (/^\d+$/.test(value)) return Number(value);
    const digits = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
    if (Object.hasOwn(digits, value)) return digits[value];
    if (/^[一二三四五六七八九]?十[一二三四五六七八九]?$/.test(value)) {
      const [tens, ones] = value.split("十");
      return (tens ? digits[tens] : 1) * 10 + (ones ? digits[ones] : 0);
    }
    return 0;
  }

  function validIndex(value) {
    return Number.isInteger(value) && value >= 0 ? value : 0;
  }

  // fieldContext is the specific field's label/name, not the entire page.
  // An explicit rank is one-based in the label; returned indexes are zero-based.
  // Conflicting ranks (e.g. a broad parent containing two labels) use the
  // caller's DOM-order index rather than silently selecting the first rank.
  function detectPreferenceIndex(fieldContext, fallbackIndex = 0) {
    const text = (Array.isArray(fieldContext) ? fieldContext.join(" ") : String(fieldContext || ""))
      .normalize("NFKC")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .toLowerCase();
    const ranks = new Set();
    const add = rank => {
      if (Number.isInteger(rank) && rank > 0) ranks.add(rank - 1);
    };
    for (const match of text.matchAll(/第\s*([一二两三四五六七八九十\d]+)\s*(?=意向|志愿|选择|优先|期望|工作|城市|地点|[)\]】]|$)/g)) {
      add(chineseNumber(match[1]));
    }
    for (const match of text.matchAll(/(?:意向城市|期望城市|工作城市|意向地点|工作地点|意向|志愿)\s*[:：#(\[]?\s*([一二两三四五六七八九十\d]+)(?![\d一二三四五六七八九十])/g)) {
      add(chineseNumber(match[1]));
    }
    if (/首选|首要意向|第一志愿/.test(text)) add(1);
    if (/次选|次要意向/.test(text)) add(2);

    const englishRanks = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 };
    const english = text.replace(/[_-]+/g, " ");
    for (const match of english.matchAll(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|\d+(?:st|nd|rd|th))\s+(?:(?:preferred|desired|target|work)\s+)?(?:city|location|choice|preference)\b/g)) {
      add(englishRanks[match[1]] || parseInt(match[1], 10));
    }
    for (const match of english.matchAll(/\b(?:preference|choice|(?:preferred|target|desired)\s*(?:city|location)|(?:city|location)\s*preference|city|location)\s*[:#(\[]?\s*(?:city\s*)?(\d+)\b/g)) {
      add(Number(match[1]));
    }
    return ranks.size === 1 ? [...ranks][0] : validIndex(fallbackIndex);
  }

  // Candidates keep the user's preference order. Never wrap to a higher
  // priority once it has been passed, invent a fallback city, or reuse a city
  // that an earlier control has actually selected.
  function getCityCandidates(value, options = {}) {
    const cities = parseOrderedValues(value);
    const index = detectPreferenceIndex(options.fieldContext, validIndex(options.index));
    const chosen = new Set(parseOrderedValues(options.chosen).map(normalizeCity));
    return cities.slice(index).filter(city => !chosen.has(normalizeCity(city)));
  }

  return { normalizeCity, cityEquals, parseOrderedValues, detectPreferenceIndex, getCityCandidates };
});
