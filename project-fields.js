(function (root) {
  "use strict";
  function projectField(text, section = "") {
    const label = String(text || "").toLowerCase().replace(/[\s_*：:（）()\-]/g, "");
    const projectSection = /项目|课题|科研|研究经历|实践经历|project|research|portfolio/i.test(section);
    if (/项目名称|项目名|课题名称|研究课题|实践名称|projectname|projecttitle|researchtitle/.test(label)) return "project_name";
    if (projectSection && /^(名称|标题|name|title)$/.test(label)) return "project_name";
    if (/开始时间|开始日期|起始时间|起始日期|startdate/.test(label)) return "start_date";
    if (/结束时间|结束日期|截止日期|enddate/.test(label)) return "end_date";
    if (/项目职责|本人职责|个人职责|职责描述|承担工作|个人贡献|本人贡献|responsibilit|mycontribution|yourcontribution/.test(label)) return "responsibilities";
    if (/项目角色|担任角色|担任职务|担任职位|职务|role/.test(label)) return "role";
    if (/项目单位|所属单位|所属机构|organization/.test(label)) return "organization";
    if (/项目描述|项目简述|项目介绍|项目内容|项目成果|项目概述|课题介绍|实践内容|projectdescription|projectsummary|projectoverview/.test(label)) return "content";
    if (projectSection && /^(描述|简介|概述|成果|description|summary|overview|achievements)$/.test(label)) return "content";
    return null;
  }
  function dateValue(raw, type) {
    if (!["date", "month"].includes(type)) return raw;
    const match = /^(\d{4})[-/.年](\d{1,2})(?:[-/.月](\d{1,2}))?日?$/.exec(raw);
    if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) return "";
    const month = `${match[1]}-${match[2].padStart(2, "0")}`;
    if (type === "month") return month;
    // Do not invent a day when only the month is known.
    return match[3] ? `${month}-${match[3].padStart(2, "0")}` : "";
  }
  const api = { projectField, dateValue };
  root.JobProjectFields = api;
  if (typeof module !== "undefined") module.exports = api;
})(globalThis);
