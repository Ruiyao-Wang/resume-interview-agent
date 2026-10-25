const assert = require("node:assert/strict");
const core = require("../core.js");

assert.equal(core.matchField("电子邮箱 Email", "text").definition.key, "email");
assert.equal(core.matchField("父亲工作单位", "text").definition.key, "fatherEmployer");
assert.equal(core.matchField("身高(cm)", "number").definition.key, "heightCm");
assert.equal(core.matchField("预计毕业时间", "date").definition.key, "graduationDate");
assert.equal(core.isSensitiveKey("weightKg"), true);
assert.equal(core.isSensitiveKey("school"), false);

// Varied wording, accessibility attributes, and camel/snake-case field names.
for (const [label, key] of [
  ["请选择您就读的学校", "school"],
  ["Institution attended", "school"],
  ["Name of educational establishment", "school"],
  ["graduateSchool", "school"],
  ["university_name", "school"],
  ["Field of study", "major"],
  ["您的研究方向", "major"],
  ["Highest educational attainment", "degree"],
  ["完成学业的年月", "graduationDate"],
  ["Expected graduation date", "graduationDate"],
  ["入学年份", "startDate"],
  ["Enrolment date", "startDate"],
  ["Education start date", "startDate"],
  ["Ｅ－ｍａｉｌ address", "email"],
  ["Contact number", "phone"],
  ["Date of birth", "birthDate"],
  ["bday", "birthDate"],
  ["City of residence", "currentCity"],
  ["希望工作的城市", "targetCity"],
  ["父亲的姓名", "fatherName"],
  ["Father's mobile number", "fatherPhone"],
  ["Mother company / organization", "motherEmployer"],
  ["Name in English", "fullNameEn"],
  ["姓名 userName", "fullNameCn"],
  ["fullName", "fullNameCn"]
]) assert.equal(core.matchField(label, "text")?.definition.key, key, label);

// Avoid false matches to a person's name, partial name, unrelated IDs or
// fields whose stored value has a different meaning.
for (const label of [
  "First name", "firstName", "first_name", "lastname", "given-name",
  "family-name", "Surname", "Middle name", "项目名称 projectName",
  "companyName", "filename", "username", "user_name", "organization-title", "organization",
  "Father first name", "Mother family name",
  "Emergency contact name", "Emergency contact phone", "父母姓名",
  "School address", "学校所在城市", "院系名称", "专业排名",
  "Degree certificate number", "Passport number", "Country code",
  "学校 邮箱", "姓名 手机", "heightened interest", "Sussex", "名称"
]) assert.equal(core.matchField(label, "text"), null, label);

assert.equal(core.matchField("紧急联系人电话", "tel"), null);
assert.equal(core.matchField("短信验证码 phone verification code", "tel"), null);
assert.equal(core.matchField("", "email").definition.key, "email");
assert.ok(core.matchField("完成学业的年月", "text").reasons[0].includes("语义组合"));
assert.equal(core.normalize("身高（ｃｍ）"), "身高cm");
console.log("core matching tests passed");
