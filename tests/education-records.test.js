const assert = require("node:assert/strict");
const education = require("../education-records.js");

// Tiny DOM-shaped fixtures keep mapping logic testable without a browser download.
class Node {
  constructor(tagName, parent = null, heading = "", explicit = false) {
    this.tagName = tagName; this.parentElement = parent; this.heading = heading;
    this.explicit = explicit; this.value = ""; this.textContent = "";
  }
  contains(other) { for (let node = other; node; node = node.parentElement) if (node === this) return true; return false; }
  matches() { return this.explicit || this.tagName === "FIELDSET"; }
  closest() { return null; }
}
function field(key, parent, value = "", context = key) {
  const element = new Node("INPUT", new Node("LABEL", parent));
  element.value = value;
  return { element, definition: { key, section: "education" }, context, empty: !value };
}
const ui = { sectionContext(element) { for (let node = element.parentElement; node; node = node.parentElement) if (node.heading) return node.heading; return ""; } };
const profile = {
  school: "默认本科大学", degree: "本科", major: "通信工程", _primaryEducation: 0,
  _educationRecords: [
    { school: "默认本科大学", degree: "本科", major: "通信工程", startDate: "2020-09", graduationDate: "2024-06", studentId: "B01" },
    { school: "示例硕士大学", degree: "硕士研究生", major: "电气工程", startDate: "2025-09", graduationDate: "2027-06", studentId: "M01" }
  ]
};

const body = new Node("BODY");
let single = field("school", body);
assert.equal(education.plan([single], profile, ui).get(single).value, "默认本科大学");
assert.equal(education.plan([single], { ...profile, _primaryEducation: 1 }, ui).get(single).value, "示例硕士大学");
assert.equal(education.plan([single], { school: "旧版学校" }, ui).get(single).value, "旧版学校");

const pairedDegree = [field("school", body), field("degree", body, "", "学历"), field("degree", body, "", "学位")];
let pairedPlan = education.plan(pairedDegree, profile, ui);
assert.equal(pairedPlan.get(pairedDegree[0]).value, "默认本科大学");
assert.equal(pairedPlan.get(pairedDegree[1]).value, "本科");
assert.equal(pairedPlan.get(pairedDegree[2]).value, "本科");
assert.equal(pairedPlan.get(pairedDegree[2]).reason, undefined);

function card(heading = "", values = {}) {
  const scope = new Node("FIELDSET", body, heading);
  return ["school", "major", "degree", "startDate", "graduationDate", "studentId"].map(key => field(key, scope, values[key] || ""));
}
let first = card("本科教育经历"), second = card("硕士教育经历");
let mapped = education.plan([...first, ...second], profile, ui);
assert.equal(mapped.get(first[0]).value, "默认本科大学");
assert.equal(mapped.get(second[0]).value, "示例硕士大学");
assert.equal(mapped.get(second[3]).value, "2025-09");
assert.equal(mapped.get(second[4]).value, "2027-06");
assert.equal(mapped.get(second[5]).value, "M01");

first = card("教育经历 1"); second = card("教育经历 2");
mapped = education.plan([...first, ...second], profile, ui);
assert.equal(mapped.get(first[0]).recordIndex, 1, "unlabelled clear cards use newest first, not the default twice");
assert.equal(mapped.get(second[0]).recordIndex, 0);

first = card("教育经历 1", { school: "默认本科大学" }); second = card("教育经历 2");
mapped = education.plan([...first, ...second], profile, ui);
assert.equal(mapped.get(first[1]).value, "通信工程");
assert.equal(mapped.get(second[1]).value, "电气工程");
assert.equal(first[0].element.value, "默认本科大学", "planner never writes DOM values");

first = card("硕士教育经历", { school: "默认本科大学" });
mapped = education.plan(first, profile, ui);
assert.match(mapped.get(first[1]).reason, /不一致/);
assert.equal(mapped.get(first[1]).value, "");

first = card("教育经历", { school: "用户手填的另一所学校" });
mapped = education.plan(first, profile, ui);
assert.match(mapped.get(first[1]).reason, /不一致/);

const loose = [field("school", body), field("school", body)];
mapped = education.plan(loose, profile, ui);
assert.match(mapped.get(loose[0]).reason, /边界/);
assert.match(mapped.get(loose[1]).reason, /边界/);

const three = [...card(), ...card(), ...card()];
mapped = education.plan(three, profile, ui);
assert.match(mapped.get(three[12]).reason, /另一段/);

first = card("本科教育经历"); second = card("本科教育经历");
mapped = education.plan([...first, ...second], profile, ui);
assert.match(mapped.get(second[0]).reason, /同一段/);

assert.deepEqual(education.valueAliases("school", "悉尼大学", "学校"), ["悉尼大学"]);
assert.deepEqual(education.valueAliases("major", "电气工程", "专业"), ["电气工程"]);
assert(education.valueAliases("degree", "本科", "学历").includes("大学本科"));
assert(education.valueAliases("degree", "本科", "学位").includes("学士"));
assert(!education.valueAliases("degree", "本科", "学位").includes("本科"));
assert(education.valueAliases("degree", "硕士研究生", "学位").includes("硕士"));
assert(!education.valueAliases("degree", "硕士研究生", "学历").includes("研究生"));
assert(!education.valueAliases("degree", "硕士研究生", "学历").some(value => /博士|PhD/.test(value)));
assert.deepEqual(education.valueAliases("degree", "研究生", "学历"), ["研究生"]);
assert.equal(education.degreeKind("本科 / 硕士"), "");
assert.equal(education.degreeKind("Bachelor's degree"), "bachelor");
assert.equal(education.degreeKind("Master’s degree"), "master");
console.log("education record mapping tests passed");
