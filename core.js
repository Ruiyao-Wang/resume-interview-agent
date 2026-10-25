(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.JobFormAutofillCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const FIELD_DEFINITIONS = [
    { key: "fullNameCn", label: "中文姓名", section: "basic", patterns: ["中文姓名", "姓名", "真实姓名", "本人姓名", "应聘者姓名", "name", "full name", "legal name", "chinese name", "candidate name", "applicant name"] },
    { key: "fullNameEn", label: "英文姓名", section: "basic", patterns: ["英文姓名", "英文名", "姓名拼音", "姓名的拼音", "english name", "name in english", "romanized name", "full name in english"] },
    { key: "email", label: "邮箱", section: "basic", inputTypes: ["email"], patterns: ["电子邮箱", "电子邮件", "电邮", "邮箱地址", "邮箱", "email", "e mail", "mail address"] },
    { key: "phone", label: "手机号码", section: "basic", inputTypes: ["tel"], patterns: ["手机号码", "联系电话", "移动电话", "联络电话", "联系号码", "手机", "电话", "mobile", "phone", "telephone", "cell number", "contact number", "tel"] },
    { key: "currentCity", label: "现居城市", section: "basic", patterns: ["现居城市", "目前城市", "目前居住地", "现居地", "常住城市", "居住城市", "居住地", "所在地", "current city", "city of residence", "residence city", "current location", "based in"] },
    { key: "targetCity", label: "意向城市", section: "basic", patterns: ["期望城市", "意向城市", "意向工作地", "期望工作地", "希望工作地", "工作地点", "求职城市", "target city", "preferred city", "preferred location", "desired location", "preferred work location"] },
    { key: "school", label: "学校", section: "education", patterns: ["毕业院校", "学校名称", "就读学校", "所在学校", "学校", "院校", "大学名称", "学府", "university", "school", "college", "educational institution", "academic institution", "institution attended", "institution name"] },
    { key: "major", label: "专业", section: "education", patterns: ["专业名称", "所学专业", "就读专业", "学科专业", "专业", "major", "field of study", "subject of study", "specialization", "discipline"] },
    { key: "degree", label: "学历", section: "education", patterns: ["最高学历", "教育程度", "文化程度", "学历", "学位", "degree", "education level", "educational level", "educational attainment", "qualification level", "academic qualification"] },
    { key: "startDate", label: "入学时间", section: "education", patterns: ["入学时间", "入学日期", "入学年月", "入学年份", "入校时间", "enrollment date", "enrolment date", "enrollment year", "enrolment year", "admission date", "education start date"] },
    { key: "graduationDate", label: "毕业时间", section: "education", patterns: ["预计毕业时间", "预期毕业", "毕业日期", "毕业时间", "毕业年月", "毕业年份", "graduation date", "graduation year", "expected graduation", "date of graduation", "completion date", "completion year"] },
    { key: "studentId", label: "学号", section: "education", patterns: ["学生编号", "学籍号", "学号", "student id", "student number", "registration number"] },
    { key: "gender", label: "性别", section: "sensitive", sensitive: true, patterns: ["性别", "gender", "sex"] },
    { key: "birthDate", label: "出生日期", section: "sensitive", sensitive: true, patterns: ["出生日期", "出生年月", "生日", "birth date", "birthday", "date of birth", "dob", "bday"] },
    { key: "heightCm", label: "身高（cm）", section: "sensitive", sensitive: true, patterns: ["身高cm", "身高", "height"] },
    { key: "weightKg", label: "体重（kg）", section: "sensitive", sensitive: true, patterns: ["体重kg", "体重", "weight"] },
    { key: "maritalStatus", label: "婚姻状况", section: "sensitive", sensitive: true, patterns: ["婚姻状况", "婚姻状态", "婚姻", "婚否", "marital status"] },
    { key: "politicalStatus", label: "政治面貌", section: "sensitive", sensitive: true, patterns: ["政治面貌", "政治身份", "党团身份", "political status", "political affiliation"] },
    { key: "ethnicity", label: "民族", section: "sensitive", sensitive: true, patterns: ["民族", "ethnicity", "ethnic group"] },
    { key: "idNumber", label: "证件号码", section: "sensitive", sensitive: true, patterns: ["身份证号码", "证件号码", "身份证号", "证件号", "id number", "identity number", "identification number", "national id"] },
    { key: "homeAddress", label: "家庭住址", section: "sensitive", sensitive: true, patterns: ["家庭住址", "家庭地址", "详细地址", "联系地址", "通讯地址", "通信地址", "居住地址", "home address", "residential address", "mailing address", "postal address", "street address"] },
    { key: "fatherName", label: "父亲姓名", section: "family", sensitive: true, patterns: ["父亲姓名", "父亲名字", "fathername"] },
    { key: "fatherEmployer", label: "父亲工作单位", section: "family", sensitive: true, patterns: ["父亲工作单位", "父亲单位", "fatheremployer"] },
    { key: "fatherPhone", label: "父亲联系电话", section: "family", sensitive: true, patterns: ["父亲联系电话", "父亲手机", "fatherphone"] },
    { key: "motherName", label: "母亲姓名", section: "family", sensitive: true, patterns: ["母亲姓名", "母亲名字", "mothername"] },
    { key: "motherEmployer", label: "母亲工作单位", section: "family", sensitive: true, patterns: ["母亲工作单位", "母亲单位", "motheremployer"] },
    { key: "motherPhone", label: "母亲联系电话", section: "family", sensitive: true, patterns: ["母亲联系电话", "母亲手机", "motherphone"] }
  ];

  const DEFAULT_PROFILE = Object.fromEntries(FIELD_DEFINITIONS.map((field) => [field.key, ""]));

  // Combinations handle paraphrased labels without requiring an exact phrase.
  // Each row requires one term from every group; the matched terms are reported.
  const CONCEPTS = {
    school: [[['教育', '学历', '学业', 'education', 'educational', 'academic'], ['机构', '院校', 'institution', 'establishment']]],
    major: [[['学习', '研究', 'study', 'academic'], ['领域', '方向', 'field', 'subject']]],
    currentCity: [[['当前', '现在', '目前', 'current', 'present'], ['居住', '城市', 'residence', 'city', 'location']]],
    targetCity: [[['意向', '期望', '希望', 'preferred', 'desired', 'target'], ['城市', '地点', 'city', 'location']]],
    graduationDate: [[['毕业', '完成学业', 'graduation', 'graduate'], ['时间', '年月', '日期', '年份', 'date', 'year', 'when']]],
    fatherName: [[['父亲', '爸爸', 'father', 'paternal'], ['姓名', '名字', 'name']]],
    fatherEmployer: [[['父亲', '爸爸', 'father', 'paternal'], ['单位', '公司', 'employer', 'company', 'organization']]],
    fatherPhone: [[['父亲', '爸爸', 'father', 'paternal'], ['手机', '电话', 'mobile', 'phone', 'telephone', 'contact number']]],
    motherName: [[['母亲', '妈妈', 'mother', 'maternal'], ['姓名', '名字', 'name']]],
    motherEmployer: [[['母亲', '妈妈', 'mother', 'maternal'], ['单位', '公司', 'employer', 'company', 'organization']]],
    motherPhone: [[['母亲', '妈妈', 'mother', 'maternal'], ['手机', '电话', 'mobile', 'phone', 'telephone', 'contact number']]]
  };

  function normalize(value) {
    return String(value || "")
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[\s:：*＊()（）\-_/.\[\]【】'’]/g, "");
  }

  function words(value) {
    return String(value || "").normalize("NFKC")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2")
      .toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]+/g, " ").trim();
  }

  function containsTerm(context, term) {
    if (/[\u3400-\u9fff]/.test(term)) return normalize(context).includes(normalize(term));
    const contextWords = ` ${words(context)} `;
    const termWords = words(term);
    // English words have boundaries: "sex" must not match "Sussex" and
    // "name" must not match an unrelated HTML identifier such as "filename".
    return contextWords.includes(` ${termWords} `) || contextWords.includes(` ${normalize(term)} `);
  }

  function hasAny(context, terms) {
    return terms.some(term => containsTerm(context, term));
  }

  function blocked(definition, context) {
    const key = definition.key;
    const splitName = hasAny(context, ["first name", "last name", "given name", "family name", "middle name", "surname", "姓氏", "名字拼音", "名拼音"]);
    if (["fullNameCn", "fullNameEn", "fatherName", "motherName"].includes(key) && splitName) return true;
    if (["fullNameCn", "fullNameEn"].includes(key) && hasAny(context, ["user name", "login name", "用户名", "登录名", "昵称", "nickname"]) && !hasAny(context, ["姓名", "真实姓名", "full name", "legal name", "real name"])) return true;

    const family = hasAny(context, ["父亲", "母亲", "父母", "爸爸", "妈妈", "father", "mother", "parent", "paternal", "maternal"]);
    const otherContact = hasAny(context, ["紧急联系人", "紧急联络人", "推荐人", "证明人", "联系人姓名", "配偶", "监护人", "emergency", "referee", "reference person", "spouse", "guardian"]);
    const organization = hasAny(context, ["学校", "院校", "大学", "学院", "项目", "公司", "企业", "单位", "机构", "证书", "附件", "职位", "岗位", "专业", "university", "school", "college", "project", "company", "employer", "organization", "institution", "establishment", "certificate", "file", "job", "major"]);
    if (["fullNameCn", "fullNameEn", "email", "phone"].includes(key) && (family || otherContact)) return true;
    if ((key === "fullNameCn" || key === "fullNameEn") && organization) return true;
    if (["email", "phone"].includes(key) && hasAny(context, ["学校电话", "公司电话", "单位电话", "公司邮箱", "学校邮箱", "employer", "company", "school", "university"])) return true;
    if (key === "phone" && hasAny(context, ["验证码", "校验码", "verification code", "sms code", "country code", "区号", "分机", "extension", "fax", "传真"])) return true;
    if (key === "email" && hasAny(context, ["验证码", "verification code"])) return true;
    if (key === "school" && hasAny(context, ["学校所在地", "院校所在地", "学校地址", "学校所在城市", "校区", "学院", "院系", "school city", "school address", "university city", "university address", "faculty", "department", "campus", "school type", "院校类型", "邮箱", "电话", "email", "phone"])) return true;
    if (key === "major" && hasAny(context, ["专业排名", "专业成绩", "专业课程", "major rank", "major gpa", "major grade"])) return true;
    if (key === "degree" && hasAny(context, ["学历证书号", "学位证书号", "学位证编号", "degree number", "degree certificate", "degree subject"])) return true;
    if (["startDate", "graduationDate"].includes(key) && hasAny(context, ["项目", "合同", "任务", "project", "contract", "employment"])) return true;
    if (key === "currentCity" && hasAny(context, ["籍贯", "户籍", "出生地", "学校", "院校", "公司", "native place", "hometown", "birthplace", "school", "university", "company"])) return true;
    if (key === "homeAddress" && hasAny(context, ["户籍", "户口", "永久地址", "注册地址", "registered address", "permanent address", "address line 2", "地址第二行"])) return true;
    if (key === "idNumber" && hasAny(context, ["护照", "passport", "证件类型", "证件有效期", "document type", "expiry", "expiration"])) return true;
    if (key === "studentId" && hasAny(context, ["公司", "企业", "business", "company"])) return true;
    return false;
  }

  function explainDefinition(definition, context, inputType) {
    if (blocked(definition, context)) return { score: 0, reasons: [] };
    let result = { score: 0, reasons: [] };
    for (const pattern of definition.patterns || []) {
      if (!containsTerm(context, pattern)) continue;
      const exact = normalize(context) === normalize(pattern);
      const score = (exact ? 125 : 80) + Math.min(normalize(pattern).length, 24);
      if (score > result.score) result = { score, reasons: [`${exact ? "标签" : "别名"}：${pattern}`] };
    }
    for (const groups of CONCEPTS[definition.key] || []) {
      const terms = groups.map(group => group.find(term => containsTerm(context, term)));
      if (terms.every(Boolean) && result.score < 108) result = { score: 108, reasons: [`语义组合：${terms.join(" + ")}`] };
    }
    if ((definition.inputTypes || []).includes(String(inputType || "").toLowerCase()) && result.score < 55) {
      result = { score: 55, reasons: [`控件类型：${inputType}`] };
    }
    return result;
  }

  function scoreDefinition(definition, context, inputType) {
    return explainDefinition(definition, context, inputType).score;
  }

  function matchField(context, inputType) {
    const candidates = FIELD_DEFINITIONS.map(definition => ({ definition, ...explainDefinition(definition, context, inputType) }))
      .filter(candidate => candidate.score > 0).sort((left, right) => right.score - left.score);
    if (!candidates.length) return null;
    // A full-name alias must not outrank the explicit English-name variant.
    if (candidates[0].definition.key === "fullNameCn") {
      const english = candidates.find(candidate => candidate.definition.key === "fullNameEn");
      if (english) return english;
    }
    if (candidates[1] && candidates[0].score - candidates[1].score < 5) return null;
    return candidates[0];
  }

  function isSensitiveKey(key) {
    return Boolean(FIELD_DEFINITIONS.find((field) => field.key === key)?.sensitive);
  }

  return { FIELD_DEFINITIONS, DEFAULT_PROFILE, normalize, scoreDefinition, matchField, isSensitiveKey };
});
