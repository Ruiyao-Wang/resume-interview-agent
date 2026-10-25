(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.JobPageContext = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DUTIES = /岗位职责|工作职责|职位职责|职位描述|岗位描述|工作内容|工作任务|主要职责|职责描述|岗位任务|你将负责|您将负责|你会做什么|你将做什么|加入后你将|你的工作|日常工作|工作概要|職務內容|職位描述|職責|\b(?:job\s+(?:description|duties)|responsibilities|role\s+(?:overview|summary)|what\s+you(?:['’]ll|\s+will)\s+do|your\s+(?:role|impact|mission)|key\s+accountabilities|about\s+the\s+role|responsible\s+for)\b/i;
  const REQUIREMENTS = /任职要求|任职资格|岗位要求|职位要求|应聘条件|应聘要求|招聘条件|招聘要求|任职条件|资格条件|基本条件|必备条件|能力要求|我们希望你|我们期待你|你需要具备|您需具备|加分项|優先條件|任職資格|應徵條件|\b(?:qualifications|requirements|what\s+you(?:['’]ll|\s+will)\s+(?:need|bring)|what\s+we(?:['’]re|\s+are)\s+looking\s+for|who\s+you\s+are|skills\s+(?:and|&)\s+experience|essential\s+criteria|nice\s+to\s+have)\b/i;
  const RECRUITMENT = /校园招聘|社会招聘|应届|校招|社招|招聘|诚聘|投递|申请职位|申请岗位|立即申请|立即应聘|演示岗位|招募|工作地点|薪资|\b(?:apply\s+(?:now|for\s+this\s+(?:job|role|position))|job\s+(?:opening|id|location)|career\s+opportunit|we(?:['’]re|\s+are)\s+(?:hiring|seeking|looking\s+for)|salary|full[- ]time|early\s+career)\b/i;
  const APPLICATION = /申请表|应聘登记|候选人信息|求职登记|投递简历|完善简历|编辑简历|我的简历|个人资料|个人信息|基本信息|教育经历|教育背景|项目经历|申请资料|\b(?:application\s+form|candidate\s+(?:profile|information)|your\s+application|personal\s+(?:information|details)|education\s+history|work\s+experience|my\s+(?:profile|resume)|edit\s+(?:profile|resume))\b/i;
  const PROFILE_PAGE = /^(?:我的简历|编辑简历|完善简历|个人资料|个人信息|简历预览|简历详情|个人中心|候选人档案|my\s+(?:resume|profile)|edit\s+(?:resume|profile)|resume\s+(?:preview|builder)|candidate\s+profile)(?:\b|[\s\-—|·：:]|$)/i;
  const LEGAL_PAGE = /隐私(?:政策|声明|条款)|用户协议|服务条款|法律声明|privacy\s+(?:policy|notice)|terms\s+(?:of\s+(?:service|use)|and\s+conditions)|cookie\s+policy/i;
  const DIRECTORY_PAGE = /公司(?:名录|目录|介绍|简介)|企业(?:名录|目录)|职位列表|岗位列表|职位搜索|所有职位|所有岗位|搜索结果|company\s+(?:directory|profile)|job\s+(?:search|listings)|search\s+results|all\s+(?:jobs|positions)/i;
  const EDUCATION_STEP = /院校选择|选择院校|选择学校|学校选择|学历选择|选择学历|教育资料|教育信息|学历信息|\b(?:select\s+(?:your\s+)?(?:school|university|degree)|education\s+(?:details|information))\b/i;
  const SCHOOL_DIRECTORY = /(?:院校|学校|高校|大学)(?:搜索|查询|检索|名录|名单|列表|排名|大全)|(?:搜索|查询)(?:院校|学校|高校|大学)|\b(?:(?:school|university|college)\s+(?:directory|search|finder|rankings|list)|(?:search|find)\s+(?:schools|universities|colleges))\b/i;
  const ROLE = /工程[师師]|分析[师師]|[设設][计計][师師]|研究[员員]|科学家|产品经理|项目经理|客户经理|业务经理|[经經]理|[专專][员員]|[顾顧][问問]|管培生|管理培训生|技术员|开发人员|研发人员|测试人员|程序员|架构师|运营策划|游戏策划|\b(?:engineer|developer|scientist|analyst|designer|researcher|manager|consultant|specialist|technician|architect|graduate\s+trainee|business\s+development|test\s+automation)\b/i;
  const CAPABILITIES = [
    /熟悉|熟练|掌握|了解|具备|能够|精通|\b(?:proficien|knowledge\s+of|experience\s+(?:with|in)|familiar\s+with|understanding\s+of|ability\s+to|skilled\s+in)\b/i,
    /本科|硕士|博士|学历|学位|相关专业|\b(?:bachelor|master|phd|degree|diploma)\b/i,
    /python|pytorch|tensorflow|java\b|c\+\+|matlab|sql\b|linux|算法|模型|软件|硬件|通信|电路|数据分析|测试|营销|运营|客户|财务|供应链|\b(?:design|sales|marketing|software|hardware|data|cloud|finance|supply\s+chain)\b/i
  ];

  const FIELD_GROUPS = {
    identity: /姓名|英文名|曾用名|\b(?:full\s*name|first\s*name|last\s*name|given\s*name|family\s*name|legal\s*name)\b/i,
    contact: /邮箱|电子邮件|联系电话|联系号码|手机|电话号码|\b(?:e[- ]?mail|phone|mobile|contact\s+number)\b/i,
    education: /院校|学校|学府|专业|学历|学位|毕业|入学|教育经历|教育背景|\b(?:school|university|college|institution|major|degree|graduation|field\s+of\s+study|education)\b/i,
    experience: /项目名称|项目描述|项目简述|项目职责|项目起止|本人职责|担任角色|工作经历|实习经历|工作单位|雇主|任职公司|任职时间|任职岗位|\b(?:project\s+(?:name|title|description|role)|employer|employment|work\s+experience|previous\s+company|job\s+title|position\s+held)\b/i,
    attachment: /简历附件|上传简历|个人简历|履历附件|\b(?:resume|curriculum\s+vitae|upload\s+cv|attach\s+cv|cover\s+letter)\b/i,
    personal: /出生|性别|民族|政治面貌|婚姻|证件号码|身份证|家庭住址|\b(?:date\s+of\s+birth|gender|nationality|marital\s+status|home\s+address)\b/i,
    preference: /期望薪资|期望薪酬|到岗时间|求职意向|期望工作地|意向城市|\b(?:salary\s+expectation|expected\s+salary|available\s+start|notice\s+period|preferred\s+location)\b/i
  };

  function clean(value) {
    return String(value == null ? "" : value).normalize("NFKC").replace(/[\t\u00a0]+/g, " ").trim();
  }

  function headingStrings(values) {
    return (Array.isArray(values) ? values : [values]).filter(Boolean).map(value => clean(typeof value === "object" ? value.text || value.label || "" : value));
  }

  function plausibleRole(value) {
    const line = clean(value).split(/\r?\n/)[0];
    if (!line || line.length > 150 || PROFILE_PAGE.test(line) || LEGAL_PAGE.test(line) || DIRECTORY_PAGE.test(line)) return "";
    if (/填写|请输入|选择|搜索|招聘流程|面试指南|\b(?:enter|select|search|interview\s+tips)\b/i.test(line)) return "";
    if (!ROLE.test(line)) return "";
    // A descriptive paragraph mentioning employees is not a role heading.
    if (/[。；;]/.test(line) || /我们的团队|公司拥有|工程师团队|\b(?:our\s+team|our\s+engineers|meet\s+the)\b/i.test(line)) return "";
    return line.replace(/\s*[|｜]\s*.*$/, "").trim();
  }

  function analyze(input = {}) {
    const title = clean(input.title);
    const headings = headingStrings(input.headings);
    const selection = clean(input.selection);
    const text = clean(input.text).slice(0, 80000);
    const body = selection.length >= 40 ? `${selection}\n${text}` : text;
    const evidence = [title, ...headings, body].join("\n");
    const labels = [...new Set(headingStrings(input.fieldLabels).map(label => label.replace(/[\s:*＊：]+/g, " ").trim()).filter(Boolean))];
    const groups = new Set();
    let relevantFields = 0;
    for (const label of labels) {
      let relevant = false;
      for (const [group, pattern] of Object.entries(FIELD_GROUPS)) {
        if (pattern.test(label)) { groups.add(group); relevant = true; }
      }
      if (relevant) relevantFields++;
    }

    const applicationCue = APPLICATION.test([title, ...headings, body.slice(0, 12000)].join("\n"));
    const experienceOrEducation = groups.has("education") || groups.has("experience");
    const applicationUrl = /\/(?:apply|applications?|sendflow|applyflow)(?:\/|[?#]|$)/i.test(clean(input.url));
    const schoolNamesOnly = !applicationUrl && /^(?:[^，,、\n。]{2,35}(?:大学|学院)(?:[，,、\s]+|$)){2,}$/.test(body);
    const schoolDirectory = schoolNamesOnly || SCHOOL_DIRECTORY.test([title, ...headings].join("\n")) || labels.some(label => /搜索|查询|检索|\b(?:search|find)\b/i.test(label));
    const explicitEducationField = labels.some(label => FIELD_GROUPS.education.test(label) && label.length <= 120 && !/搜索|查询|检索|\b(?:search|find)\b/i.test(label));
    // Some sites display one school selector at a time. Its form label plus the
    // application route or selection-step heading is enough; no JD is required.
    const singleEducationStep = explicitEducationField && !schoolDirectory && relevantFields >= 1 &&
      (applicationUrl || EDUCATION_STEP.test([title, ...headings].join("\n")));
    const isApplication = (groups.size >= 2 && relevantFields >= 3) ||
      (groups.size >= 2 && relevantFields >= 2 && (applicationCue || groups.has("attachment"))) ||
      (experienceOrEducation && relevantFields >= 2 && applicationCue) || singleEducationStep;
    const applicationConfidence = Math.min(0.99, Math.max(singleEducationStep ? 0.68 : 0, Math.round((groups.size * 0.16 + Math.min(relevantFields, 4) * 0.08 + (applicationCue ? 0.18 : 0)) * 100) / 100));

    const primaryHeading = headings[0] || "";
    const legalPage = LEGAL_PAGE.test(title) || LEGAL_PAGE.test(primaryHeading);
    const profilePage = PROFILE_PAGE.test(title) || PROFILE_PAGE.test(primaryHeading);
    const candidateTitles = headings.map(plausibleRole).filter(Boolean);
    const jobTitle = plausibleRole(title) || candidateTitles[0] || "";
    const listingPage = DIRECTORY_PAGE.test(title) || DIRECTORY_PAGE.test(primaryHeading) || (candidateTitles.length >= 5 && !plausibleRole(title));
    const duties = DUTIES.test(evidence);
    const requirements = REQUIREMENTS.test(evidence);
    const recruitment = RECRUITMENT.test(evidence);
    const capabilityCount = CAPABILITIES.filter(pattern => pattern.test(body)).length;
    const inferredRequirements = capabilityCount >= 2 && CAPABILITIES[0].test(body) && recruitment && Boolean(jobTitle);
    const enoughContent = body.length >= 45;
    const reasons = [];
    if (isApplication) reasons.push(`识别到${relevantFields}个申请字段，覆盖${groups.size}类资料`);
    if (duties) reasons.push("包含工作职责或同义描述");
    if (requirements) reasons.push("包含任职条件或能力要求");
    if (jobTitle) reasons.push("识别到具体岗位名称");
    if (recruitment) reasons.push("包含招聘或申请线索");

    if (inferredRequirements && !requirements) reasons.push("从技能和学历叙述推断岗位条件");
    let confidence = (duties ? 0.27 : 0) + (requirements ? 0.23 : inferredRequirements ? 0.1 : 0) + (jobTitle ? 0.23 : 0) + (recruitment ? 0.12 : 0) + (capabilityCount >= 2 ? 0.10 : 0) + (enoughContent ? 0.05 : 0);
    const hasRecruitmentContext = Boolean(jobTitle || recruitment);
    const hasDescription = duties || requirements || inferredRequirements;
    let isJobDetail = enoughContent && hasRecruitmentContext && hasDescription && confidence >= 0.55;
    if (legalPage || profilePage || listingPage) {
      isJobDetail = false;
      confidence = Math.min(confidence, 0.2);
      reasons.push(legalPage ? "当前是政策或协议页面" : profilePage ? "当前是个人简历或资料页面" : "当前是目录或岗位列表页面");
    }
    if (!isJobDetail && !legalPage && !profilePage && !listingPage) reasons.push(isApplication ? "当前可填写资料，岗位选材可沿用已识别岗位" : "现有内容不足以确认某个具体岗位的要求");
    return {
      isJobDetail, isApplication, confidence: Math.min(0.99, Math.round(confidence * 100) / 100), applicationConfidence,
      reasons, jobTitle: isJobDetail ? jobTitle : "",
      signals: { duties, requirements, recruitment, capabilityCount, relevantFields, fieldGroups: [...groups], legalPage, profilePage, listingPage, applicationUrl, singleEducationStep, schoolDirectory }
    };
  }

  return { analyze };
});
