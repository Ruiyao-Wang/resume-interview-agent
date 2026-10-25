"use strict";
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  // Only extension pages can ask the worker to read local resume files.
  if (!sender.url?.startsWith(chrome.runtime.getURL(""))) return false;
  if (message.type !== "MATERIAL_API") return false;
  (async () => {
    const stored = await chrome.storage.local.get("backendPort");
    const port = Number(stored.backendPort || 8765);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("本地后台端口无效");
    const BACKEND = `http://127.0.0.1:${port}`;
    let path, options = {};
    if (message.action === "profile") {
      path = "/api/profile";
    } else if (message.action === "profile_import") {
      path = "/api/profile/import";
      options = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ profile: message.profile }) };
    } else if (message.action === "match") {
      path = "/api/match";
      options = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(message.payload) };
    } else if (message.action === "attachment" && /^[a-f0-9-]{36}$/.test(message.id || "")) {
      path = `/api/resumes/${message.id}/attachment`;
    } else throw new Error("不支持的操作");
    const response = await fetch(BACKEND + path, { ...options, signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`后台返回 ${response.status}，请检查素材是否仍存在`);
    return { data: await response.json() };
  })().then(respond).catch(error => respond({ error: `连接素材库失败：${error.message}。请先运行“启动后台.bat”。` }));
  return true;
});
