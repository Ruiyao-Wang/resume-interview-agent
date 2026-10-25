"use strict";
const importButton = document.getElementById("importLegacy");
const status = document.getElementById("status");
document.getElementById("openBackend").addEventListener("click", () => chrome.tabs.create({ url: "http://127.0.0.1:8765/#personalSection" }));
(async () => {
  const stored = await chrome.storage.local.get("profile");
  const count = Object.values(stored.profile || {}).filter(value => String(value).trim()).length;
  document.getElementById("legacySummary").textContent = count ? `旧插件中有 ${count} 个已填字段。` : "没有需要导入的旧资料，可直接去后台填写。";
  importButton.disabled = !count;
})().catch(error => { status.textContent = error.message; });
importButton.addEventListener("click", async () => {
  importButton.disabled = true;
  try {
    const stored = await chrome.storage.local.get("profile");
    const response = await chrome.runtime.sendMessage({ type: "MATERIAL_API", action: "profile_import", profile: stored.profile || {} });
    if (!response || response.error) throw new Error(response?.error || "后台未响应");
    status.textContent = "已导入，请打开后台核对。旧插件资料仍保留。";
    status.classList.add("show");
  } catch (error) {
    status.textContent = error.message;
    status.classList.add("show");
    importButton.disabled = false;
  }
});
