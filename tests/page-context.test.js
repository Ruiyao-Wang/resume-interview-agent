const assert = require("node:assert/strict");
const { analyze } = require("../page-context.js");

const fixtures = [
  {
    name: "Chinese nonstandard duty and requirements headings",
    input: { title: "影像效果工程师 - 校园招聘", headings: ["影像效果工程师", "你将负责", "我们希望你"], text: "你将负责手机相机的颜色、降噪和亮度调优，定位真实使用场景中的图像质量问题。我们希望你了解图像处理、具备 C++ 编程基础，本科及以上学历。" },
    expected: { isJobDetail: true, isApplication: false }
  },
  {
    name: "English natural language role sections",
    input: { title: "Graduate Software Engineer | Careers", headings: ["Your impact", "What you bring"], text: "Your impact: develop reliable software and help customers solve integration problems. What you bring: a degree in computer science and experience with Python and SQL. Apply now." },
    expected: { isJobDetail: true, isApplication: false }
  },
  {
    name: "Unlabelled qualifications plus specific hiring role",
    input: { title: "数据分析师", text: "我们正在招聘数据分析师，工作地点为北京。熟悉 SQL 和 Python，能够处理业务数据、搭建报表并与业务团队沟通分析结果。本科及以上学历，欢迎应届生申请。" },
    expected: { isJobDetail: true, isApplication: false }
  },
  {
    name: "Traditional Chinese duties",
    input: { title: "軟體工程師", headings: ["職務內容", "應徵條件"], text: "職務內容：開發資料處理和內部分析工具，與團隊合作完成產品功能及測試。應徵條件：熟悉 Python 與 SQL，具備軟體開發相關經驗。" },
    expected: { isJobDetail: true, isApplication: false }
  },
  {
    name: "Local demo contains application and job in one page",
    input: { title: "试填演示 · 求职助手", headings: ["本地试填演示", "模型评测工程师（演示岗位）", "基本信息", "项目经历", "附件"], text: "岗位职责：使用 Python、PyTorch 完成计算机视觉模型评测、数据质量分析与误差定位。要求了解语义分割、IoU、MAE、数据划分与模型验证。", fieldLabels: ["姓名", "电子邮箱", "简历附件"] },
    expected: { isJobDetail: true, isApplication: true }
  },
  {
    name: "Chinese application fields with no conventional section heading",
    input: { title: "候选人登记", text: "请依次填写以下内容", fieldLabels: ["中文姓名", "联系号码", "毕业学府", "所学专业", "个人履历附件"] },
    expected: { isJobDetail: false, isApplication: true }
  },
  {
    name: "English multi-field application without headings",
    input: { title: "Step 2", text: "Tell us a little about yourself.", fieldLabels: ["Given name", "Family name", "E-mail address", "Institution", "Field of study"] },
    expected: { isJobDetail: false, isApplication: true }
  },
  {
    name: "Education-only application step",
    input: { title: "完善简历 · 教育背景", fieldLabels: ["学校", "专业", "毕业时间"] },
    expected: { isJobDetail: false, isApplication: true }
  },
  {
    name: "Single school does not become job description",
    input: { title: "请选择学校", fieldLabels: ["学校"], text: "北京大学，悉尼大学，上海交通大学" },
    expected: { isJobDetail: false, isApplication: false }
  },
  {
    name: "Single school selector on an education application route",
    input: { title: "院校选择", url: "https://careers.example/apply/education", fieldLabels: ["学校"], text: "请选择你的毕业院校" },
    expected: { isJobDetail: false, isApplication: true }
  },
  {
    name: "Single university field on an unlabeled send-flow step",
    input: { title: "Step 2", url: "https://careers.example/app/sendFlow/1", fieldLabels: ["University"], text: "Next" },
    expected: { isJobDetail: false, isApplication: true }
  },
  {
    name: "Single degree field with explicit selection-step heading",
    input: { title: "学历选择", fieldLabels: ["最高学历"], text: "本科 硕士 博士" },
    expected: { isJobDetail: false, isApplication: true }
  },
  {
    name: "University directory search is not education application",
    input: { title: "University directory", url: "https://universities.example/search", fieldLabels: ["School"], text: "Find universities and compare rankings worldwide." },
    expected: { isJobDetail: false, isApplication: false }
  },
  {
    name: "School search is not an application despite selection route text",
    input: { title: "院校查询", url: "https://example/apply/education", fieldLabels: ["搜索学校"], text: "查找学校以及学校的招生信息" },
    expected: { isJobDetail: false, isApplication: false }
  },
  {
    name: "Email-only newsletter does not inherit application route",
    input: { title: "Keep in touch", url: "https://careers.example/apply", fieldLabels: ["Email"], text: "Subscribe to updates." },
    expected: { isJobDetail: false, isApplication: false }
  },
  {
    name: "Login fields do not become application",
    input: { title: "招聘门户 - 登录", fieldLabels: ["邮箱", "密码", "验证码"], text: "登录后申请职位，查看岗位要求和投递记录。" },
    expected: { isJobDetail: false, isApplication: false }
  },
  {
    name: "Search filters are not application",
    input: { title: "职位搜索", fieldLabels: ["关键词", "工作地点", "部门", "搜索职位"], text: "工程师 产品经理 分析师 岗位名称 立即搜索" },
    expected: { isJobDetail: false, isApplication: false }
  },
  {
    name: "Privacy text quoting duties is not JD",
    input: { title: "招聘隐私政策", headings: ["招聘隐私政策"], text: "我们会收集您投递软件工程师职位时提供的信息，包括学历、个人信息与工作职责。岗位要求与申请信息可能用于人员招聘和资格核对。我们可能要求提供联系方式。", fieldLabels: [] },
    expected: { isJobDetail: false, isApplication: false }
  },
  {
    name: "Resume remains application even when it contains target job and duties",
    input: { title: "我的简历 - 招聘门户", headings: ["算法工程师", "工作职责"], text: "求职意向为算法工程师，熟悉 Python 和 PyTorch，具备硕士学历。工作职责包括开展模型训练、评测以及数据清洗。任职要求匹配信息可供参考。", fieldLabels: ["姓名", "学校", "邮箱"] },
    expected: { isJobDetail: false, isApplication: true }
  },
  {
    name: "Company directory is not detailed job",
    input: { title: "企业名录", headings: ["数据分析师", "软件工程师"], text: "数据分析师 岗位职责：分析数据。任职要求：Python、SQL。软件工程师 岗位职责：软件开发。任职要求：熟悉 C++。查看所有公司招聘信息。" },
    expected: { isJobDetail: false, isApplication: false }
  },
  {
    name: "Legal footer does not suppress a genuine job",
    input: { title: "嵌入式开发工程师 - 校招", headings: ["嵌入式开发工程师", "岗位职责", "任职条件", "隐私政策"], text: "岗位职责：负责嵌入式硬件系统开发和信号处理，实现设备调试与性能验证。任职条件：通信或电子相关专业硕士，熟悉 MATLAB、C++，了解 ARM。页脚：隐私政策，用户协议。" },
    expected: { isJobDetail: true, isApplication: false }
  }
];

for (const fixture of fixtures) {
  const result = analyze(fixture.input);
  for (const [key, value] of Object.entries(fixture.expected)) assert.equal(result[key], value, `${fixture.name}: ${key}; ${JSON.stringify(result)}`);
  assert.ok(result.confidence >= 0 && result.confidence <= 1);
  assert.ok(Array.isArray(result.reasons));
}
assert.equal(analyze(fixtures[4].input).jobTitle, "模型评测工程师(演示岗位)");
assert.equal(analyze().isJobDetail, false);
assert.equal(analyze({ fieldLabels: [{ text: "学校" }, { label: "姓名" }, "邮箱"] }).isApplication, true);
console.log(`page context tests passed (${fixtures.length} page fixtures)`);
