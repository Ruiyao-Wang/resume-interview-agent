"use strict";
function addProject() {
  const card = document.createElement("div");
  card.className = "card";
  for (const [title, key] of [["项目名称", "name"], ["项目开始时间", "start"], ["项目结束时间", "end"], ["职务", "role"], ["项目职责", "responsibilities"], ["项目简述", "content"]]) {
    const label = document.createElement("label");
    label.textContent = title;
    const input = document.createElement(["content", "responsibilities"].includes(key) ? "textarea" : "input");
    input.setAttribute("aria-label", title);
    label.append(input);
    card.append(label);
  }
  document.getElementById("projectCards").append(card);
}
document.getElementById("addProject").addEventListener("click", addProject);
document.getElementById("resumeUpload").addEventListener("change", event => {
  document.getElementById("fileStatus").textContent = event.target.files[0] ? `已接收文件：${event.target.files[0].name}（本地演示，不上传服务器）` : "尚未选择文件";
});
addProject();
