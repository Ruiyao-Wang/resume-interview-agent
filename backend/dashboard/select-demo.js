(function () {
  "use strict";

  const controls = [];
  const clean = value => typeof value === "string" ? value.trim() : "";
  const normalized = value => clean(value).normalize("NFKC").toLowerCase().replace(/\s+/g, "");
  const unique = values => [...new Set(values.map(clean).filter(Boolean))];

  function createDropdown(id, caption, values) {
    const choices = unique(values).map((label, index) => ({ label, code: id + "-option-" + (index + 1) }));
    const label = document.createElement("label");
    label.htmlFor = id;
    const heading = document.createElement("span");
    heading.textContent = caption;
    const shell = document.createElement("div");
    shell.className = "demo-select";
    const input = document.createElement("input");
    input.id = id;
    input.name = id;
    input.type = "text";
    input.autocomplete = "off";
    input.placeholder = "请选择或搜索";
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-label", caption);
    input.setAttribute("aria-expanded", "false");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-controls", id + "-options");
    const committedCode = document.createElement("input");
    committedCode.type = "hidden";
    committedCode.name = id + "-code";
    committedCode.readOnly = true;
    const list = document.createElement("div");
    list.id = id + "-options";
    list.className = "demo-options";
    list.setAttribute("role", "listbox");
    list.setAttribute("aria-label", caption + "候选项");
    list.hidden = true;
    const status = document.createElement("output");
    status.className = "selection-status";
    status.textContent = "尚未选择";
    status.setAttribute("aria-live", "polite");
    let committedLabel = "";

    function close() {
      list.hidden = true;
      input.setAttribute("aria-expanded", "false");
    }

    function render(query) {
      list.replaceChildren();
      const filtered = choices.filter(choice => normalized(choice.label).includes(normalized(query)));
      if (!filtered.length) {
        const empty = document.createElement("div");
        empty.className = "demo-empty";
        empty.textContent = "暂无选项";
        list.append(empty);
      }
      for (const choice of filtered) {
        const option = document.createElement("div");
        option.className = "demo-option";
        option.id = choice.code;
        option.tabIndex = -1;
        option.setAttribute("role", "option");
        option.setAttribute("data-value", choice.code);
        option.setAttribute("aria-selected", String(committedCode.value === choice.code));
        option.textContent = choice.label;
        option.addEventListener("click", event => {
          event.preventDefault();
          event.stopPropagation();
          input.value = choice.label;
          committedLabel = choice.label;
          committedCode.value = choice.code;
          option.setAttribute("aria-selected", "true");
          status.dataset.selected = "true";
          status.textContent = "已选择：" + choice.label + "（代码 " + choice.code + "）";
          close();
          input.dispatchEvent(new Event("change", { bubbles: true }));
        });
        option.addEventListener("keydown", event => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            option.click();
          } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            (event.key === "ArrowDown" ? option.nextElementSibling : option.previousElementSibling)?.focus();
          } else if (event.key === "Escape") {
            close();
            input.focus();
          }
        });
        list.append(option);
      }
    }

    function open(query) {
      for (const control of controls) if (control.input !== input) control.close();
      render(query);
      list.hidden = false;
      input.setAttribute("aria-expanded", "true");
    }

    input.addEventListener("click", () => open(input.value === committedLabel ? "" : input.value));
    input.addEventListener("input", () => {
      // Search text is not a committed option value. Keep the code empty until
      // an option is actually clicked, as a real application form would do.
      committedCode.value = "";
      committedLabel = "";
      status.dataset.selected = "false";
      status.textContent = input.value ? "正在搜索，尚未选择" : "尚未选择";
      open(input.value);
    });
    input.addEventListener("keydown", event => {
      if (event.key === "Escape") close();
      else if (event.key === "ArrowDown") {
        event.preventDefault();
        if (list.hidden) open(input.value === committedLabel ? "" : input.value);
        list.querySelector("[role='option']")?.focus();
      } else if (event.key === "Enter" && !list.hidden) {
        const options = list.querySelectorAll("[role='option']");
        if (options.length === 1) {
          event.preventDefault();
          options[0].click();
        }
      }
    });
    shell.append(input, committedCode, list);
    label.append(heading, shell, status);
    controls.push({ input, shell, close });
    return label;
  }

  function monthField(id, caption) {
    const label = document.createElement("label");
    label.htmlFor = id;
    label.textContent = caption;
    const input = document.createElement("input");
    input.id = id;
    input.name = id;
    input.type = "month";
    input.setAttribute("aria-label", caption);
    label.append(input);
    return label;
  }

  function degreeOptions(records) {
    return unique(records.map(record => record.degree).concat(["大学本科", "硕士研究生", "博士研究生", "大学专科"]))
      .filter(value => !/^(本科|学士|硕士|博士|大专|专科)$/.test(value));
  }

  const cities = ["北京", "南京", "上海", "郑州", "深圳", "西安", "广州", "杭州", "成都"];
  document.getElementById("cityFields").append(
    createDropdown("targetCity1", "第一意向城市", cities),
    createDropdown("targetCity2", "第二意向城市", cities)
  );
  document.addEventListener("click", event => {
    for (const control of controls) if (!control.shell.contains(event.target)) control.close();
  });

  async function loadEducation() {
    const notice = document.getElementById("educationNotice");
    try {
      // Read only. Never populate a field or write personal material on this page.
      const response = await fetch("/api/profile", { cache: "no-store" });
      if (!response.ok) throw new Error("profile-unavailable");
      const data = await response.json();
      const records = (Array.isArray(data.education) ? data.education : []).filter(record =>
        record && typeof record === "object" && [record.school, record.major, record.degree].some(clean));
      if (!records.length) {
        notice.textContent = "还没有保存教育经历。请返回素材库添加并保存本科、硕士等真实经历，再刷新本页。";
        return;
      }
      const schools = unique(records.map(record => record.school));
      const majors = unique(records.map(record => record.major));
      const degrees = degreeOptions(records);
      const shown = records.slice(0, 2);
      for (const [index, record] of shown.entries()) {
        const prefix = "education-" + (index + 1);
        const card = document.createElement("fieldset");
        card.className = "education-card";
        card.dataset.educationRecord = String(index);
        const legend = document.createElement("legend");
        legend.textContent = (clean(record.degree) || "教育经历") + " · 经历 " + (index + 1);
        const fields = document.createElement("div");
        fields.className = "profile-grid";
        fields.append(
          createDropdown(prefix + "-school", "毕业院校", schools),
          createDropdown(prefix + "-degree", "学历", degrees),
          createDropdown(prefix + "-major", "所学专业", majors),
          monthField(prefix + "-startDate", "入学时间"),
          monthField(prefix + "-graduationDate", "毕业时间")
        );
        card.append(legend, fields);
        document.getElementById("educationCards").append(card);
      }
      notice.textContent = "已准备 " + shown.length + " 条教育经历的空白试填栏。下拉框包含你保存的学校、专业，以及“大学本科”“硕士研究生”等学历表述。请点击插件开始填写。";
    } catch (_) {
      notice.textContent = "暂时无法读取资料。请确认本地后台正在运行，并在素材库保存教育经历后刷新本页。";
    }
  }

  loadEducation();
})();
