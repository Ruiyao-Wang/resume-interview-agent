const assert = require("node:assert/strict");
const preferences = require("../preference-values.js");

assert.deepEqual(preferences.parseOrderedValues("北京，南京、上海;郑州；深圳|杭州\n苏州\r\n成都"),
  ["北京", "南京", "上海", "郑州", "深圳", "杭州", "苏州", "成都"]);
assert.deepEqual(preferences.parseOrderedValues([" 北京市，南京", "北京", ["上海", "南京市"]]),
  ["北京市", "南京", "上海"]);
assert.deepEqual(preferences.parseOrderedValues(undefined), []);
assert.deepEqual(preferences.parseOrderedValues({ city: "北京" }), []);
assert.deepEqual(preferences.parseOrderedValues(" , ， ；\n"), []);
assert.deepEqual(preferences.parseOrderedValues("New York, Sydney"), ["New York", "Sydney"]);

assert.equal(preferences.cityEquals(" 北京市 ", "北京"), true);
assert.equal(preferences.cityEquals("ＮＥＷ ＹＯＲＫ", "New York"), true);
assert.equal(preferences.cityEquals("南京", "南宁"), false);
assert.equal(preferences.cityEquals("北京", "北京市朝阳区"), false);
assert.equal(preferences.cityEquals("郑州", "郑州市高新区"), false);
assert.equal(preferences.cityEquals("苏州", "江苏省"), false);
assert.equal(preferences.cityEquals("", ""), false);

for (const [context, expected] of [
  ["第一意向城市 *", 0], ["第二意向城市 *", 1], ["第三志愿", 2], ["第1志愿", 0],
  ["第２期望工作地点", 1], ["第十意向城市", 9], ["第二十一意向城市", 20],
  ["首选城市", 0], ["次选城市", 1], ["意向城市（二）", 1], ["意向城市2", 1],
  ["城市意向（第二）", 1], ["preference1", 0], ["preference_2", 1],
  ["preferredCity2", 1], ["cityPreference3", 2], ["choice_2", 1], ["city1", 0], ["targetCity2", 1],
  ["First preferred city", 0], ["Second choice", 1], ["Third location", 2],
  ["2nd preferred location", 1], ["firstChoice", 0], ["preference city 2", 1]
]) assert.equal(preferences.detectPreferenceIndex(context, 7), expected, context);

assert.equal(preferences.detectPreferenceIndex("意向城市", 1), 1);
assert.equal(preferences.detectPreferenceIndex("第一意向城市 第二意向城市", 2), 2);
assert.equal(preferences.detectPreferenceIndex("2027校园招聘 意向城市", 2), 2);
assert.equal(preferences.detectPreferenceIndex("1234", 2), 2);
assert.equal(preferences.detectPreferenceIndex("", -1), 0);

const cities = "北京，南京，上海，郑州";
assert.deepEqual(preferences.getCityCandidates(cities, { fieldContext: "第一意向城市" }), ["北京", "南京", "上海", "郑州"]);
assert.deepEqual(preferences.getCityCandidates(cities, { fieldContext: "第二意向城市", chosen: ["北京市"] }), ["南京", "上海", "郑州"]);
// First field selected 南京 because 北京 was not offered: never choose 南京 again.
assert.deepEqual(preferences.getCityCandidates(cities, { fieldContext: "第二意向城市", chosen: ["南京市"] }), ["上海", "郑州"]);
assert.deepEqual(preferences.getCityCandidates(cities, { index: 2, chosen: "北京，南京" }), ["上海", "郑州"]);
assert.deepEqual(preferences.getCityCandidates(cities, { fieldContext: "第二意向城市", index: 0 }), ["南京", "上海", "郑州"]);
assert.deepEqual(preferences.getCityCandidates(cities, { index: 4 }), []);
assert.deepEqual(preferences.getCityCandidates("北京", { fieldContext: "第二意向城市" }), []);
assert.deepEqual(preferences.getCityCandidates(cities, { chosen: cities }), []);
assert.deepEqual(preferences.getCityCandidates("", {}), []);

console.log("city preference value tests passed");
