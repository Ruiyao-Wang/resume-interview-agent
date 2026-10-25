(function () {
  "use strict";
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const normalize = text => String(text || "").normalize("NFKC").toLowerCase().trim().replace(/^\d+\s*[-:：]\s*/, "").replace(/\s+/g, "");
  const shells = ".ant-select, .el-select, .select2-container, .ivu-select, .arco-select, .n-select, .v-select, [role='combobox']";
  const lists = "[role='listbox'], .ant-select-dropdown, .el-select-dropdown, .select2-dropdown, .ivu-select-dropdown, .arco-select-popup, .n-base-select-menu, .vs__dropdown-menu";
  const optionSelector = "[role='option'], .ant-select-item-option, .el-select-dropdown__item, .select2-results__option, .ivu-select-item, .arco-select-option, .n-base-select-option, .vs__dropdown-option";
  const selectionSelector = ".ant-select-selection-item, .el-select__selected-item:not(.is-transparent):not(.el-select__placeholder):not(.el-select__input-wrapper), .select2-selection__rendered[title], .ivu-select-selected-value, .arco-select-view-value, .n-base-selection-label .n-base-selection-input, .vs__selected";
  const placeholder = /^(?:请选择.*|选择学校|select(?: an? option)?|please select.*)[…。.\s]*$/i;
  function shell(element) { return element.closest(shells) || element; }
  function linkedNodes(element) {
    const container = shell(element);
    const input = element.matches("input") ? element : container.querySelector("input:not([type=hidden])");
    const ids = [element, container, input].filter(Boolean).flatMap(el => ((el.getAttribute("aria-controls") || "") + " " + (el.getAttribute("aria-owns") || "")).trim().split(/\s+/)).filter(Boolean);
    return [...new Set(ids.map(id => document.getElementById(id)).filter(Boolean))];
  }
  function isCombo(element) {
    return !!element.closest(shells) || element.matches("input[list], [aria-haspopup='listbox'], [aria-autocomplete='list'], [aria-autocomplete='both']") || linkedNodes(element).some(node => node.matches(lists) || node.querySelector(optionSelector));
  }
  function selectedText(element) {
    if (element.tagName === "SELECT") return element.selectedOptions[0]?.textContent?.trim() || "";
    const selected = shell(element).querySelector(selectionSelector);
    return String(selected?.getAttribute("title") || selected?.textContent || element.value || element.innerText || "").trim();
  }
  function empty(element) {
    if (element.tagName === "SELECT") return !element.value || placeholder.test(selectedText(element));
    const selected = shell(element).querySelector(selectionSelector);
    if (selected && !placeholder.test(selected.textContent.trim()) && selected.textContent.trim()) return false;
    const value = element.value ?? shell(element).querySelector("input")?.value ?? element.innerText ?? "";
    return !String(value).trim() || placeholder.test(String(value).trim());
  }
  function putSearch(input, value) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }
  function candidatesFor(value, config) {
    return [...new Set(config.candidates || [value])].filter(Boolean).map(candidate => ({
      value: candidate,
      aliases: globalThis.JobEducationRecords?.valueAliases(config.key, candidate, config.context || "") || [candidate]
    }));
  }
  function equals(text, candidate, config) {
    return candidate.aliases.some(alias => normalize(text) === normalize(alias) || ["targetCity", "currentCity"].includes(config.key) && globalThis.JobPreferenceValues?.cityEquals(text, alias));
  }
  function label(option) { return (option.getAttribute("title") || option.getAttribute("aria-label") || option.textContent || "").trim(); }
  function enabled(option) { return !option.disabled && !option.parentElement?.disabled && option.getAttribute("aria-disabled") !== "true" && !option.matches(".is-disabled, .ant-select-item-option-disabled, .ivu-select-item-disabled, .arco-select-option-disabled, .n-base-select-option--disabled"); }
  function find(options, candidates, config) {
    for (const candidate of candidates) {
      // Exact visible labels outrank an opaque option value which happens to match.
      let matches = options.filter(option => equals(label(option), candidate, config));
      if (!matches.length) matches = options.filter(option => equals(option.value || option.getAttribute("data-value"), candidate, config));
      matches = matches.filter(el => !matches.some(other => other !== el && other.contains(el)));
      if (matches.length) return { matches, candidate };
    }
    return null;
  }
  async function fill(element, value, ui, config = {}) {
    const candidates = candidatesFor(value, config);
    if (!candidates.length) return { ok: false, reason: "没有剩余的已保存意向，请补充选择，未随机选项" };
    if (element.tagName === "SELECT" || element.matches("input[list]")) {
      const native = element.tagName === "SELECT";
      const source = native ? element : document.getElementById(element.getAttribute("list"));
      element.focus();
      for (let attempt = 0; attempt < 15; attempt++) {
        const options = [...(source?.options || [])].filter(option => enabled(option) && option.value && !placeholder.test(label(option)));
        const match = find(options, candidates, config);
        if (match?.matches.length > 1) return { ok: false, reason: "存在多个同名选项，需要核对后选择" };
        if (match) {
          const option = match.matches[0], selectedValue = option.value;
          if (native) element.value = selectedValue;
          else putSearch(element, selectedValue);
          element.dispatchEvent(new Event("input", { bubbles: true }));
          element.dispatchEvent(new Event("change", { bubbles: true }));
          await sleep(150);
          return element.value === selectedValue ? { ok: true, selectedValue: match.candidate.value, selectedLabel: label(option) || selectedValue } : { ok: false, reason: "网站没有保留选择，请检查前置字段" };
        }
        await sleep(100);
      }
      return { ok: false, reason: "选项未匹配已存资料“" + candidates.map(c => c.value).join("、") + "”，请检查前置字段或补充网站使用的名称" };
    }

    const container = shell(element);
    const input = element.matches("input") ? element : container.querySelector("input:not([type=hidden])");
    const before = new Set([...document.querySelectorAll(lists)].filter(ui.visible));
    const original = input?.value || "";
    let typed = null, confirmed = false, clicked = false;
    function dropdowns() {
      const linked = linkedNodes(element).filter(ui.visible);
      const opened = linked.length ? linked : [...document.querySelectorAll(lists)].filter(el => ui.visible(el) && (!before.has(el) || container.contains(el)));
      return opened.filter(el => !opened.some(other => other !== el && other.contains(el)));
    }
    function optionsIn(region) {
      let options = [...region.querySelectorAll(optionSelector)].filter(ui.visible);
      // Some sites omit role=option but expose a clearly linked listbox with list items.
      if (!options.length) options = [...region.querySelectorAll("li, [data-value], .dropdown-item")].filter(ui.visible);
      return options.filter(option => enabled(option) && !placeholder.test(label(option)) && !/^(暂无选项|无匹配数据|无数据|no (?:options|results)(?: found)?)$/i.test(label(option)));
    }
    async function choose(match) {
      if (match.matches.length > 1) return { ok: false, reason: "存在多个同名选项，需要核对后选择" };
      const option = match.matches[0], chosenLabel = label(option);
      clicked = true;
      option.click();
      for (let attempt = 0; attempt < 8; attempt++) {
        await sleep(100);
        const selected = container.querySelector(selectionSelector);
        const retained = selected && equals(label(selected), match.candidate, config) || !dropdowns().length && equals(input?.value ?? element.innerText, match.candidate, config);
        if (retained || option.isConnected && option.getAttribute("aria-selected") === "true") {
          confirmed = true;
          return { ok: true, selectedValue: match.candidate.value, selectedLabel: chosenLabel };
        }
      }
      return { ok: false, reason: "已点击匹配选项，但未确认网站接受，请核对该栏" };
    }
    try {
      element.focus(); element.click();
      await sleep(120);
      const searchable = input && !input.readOnly && !input.disabled;
      // Every query is one saved value, never the whole comma-separated preference list.
      for (const candidate of candidates) {
        const queries = searchable ? [...new Set(candidate.aliases)] : [null];
        for (const query of queries) {
          if (query !== null) { typed = query; putSearch(input, query); }
          for (let attempt = 0; attempt < 15; attempt++) {
            const regions = dropdowns();
            if (regions.length > 1) return { ok: false, reason: "出现多个无法关联的列表，请关闭其他列表后重试" };
            if (regions.length === 1) {
              const match = find(optionsIn(regions[0]), searchable ? [candidate] : candidates, config);
              if (match) return await choose(match);
            }
            await sleep(100);
          }
        }
        if (!searchable) break;
      }
    } finally {
      // A temporary search is not a chosen option. Restore it on failure, without overwriting a clicked selection.
      if (!confirmed && !clicked && input && !input.readOnly && typed !== null && input.value === typed) putSearch(input, original);
      if (dropdowns().length) (input || element).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
    }
    return { ok: false, reason: "没有找到唯一匹配选项，请检查国家/地区等前置项或名称：" + candidates.map(c => c.value).join("、") };
  }
  globalThis.JobSelectControls = { isCombo, empty, fill, shell, selectedText };
})();
