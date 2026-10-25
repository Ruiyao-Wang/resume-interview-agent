/* A small, dependency-free client. User and model text is always rendered as text. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const STAGES = {
    parse_resume: '简历解析', parse_jd: 'JD 解析', match: '匹配分析', questions: '生成问题',
    awaiting_answer: '逐题回答', evaluate: '回答评价', follow_up: '判断追问', weak_points: '记录薄弱点', report: '最终报告',
  };
  const STATUS = { uploaded: '材料已保存', preparing: '分析中', running: '执行中', awaiting_answer: '等待回答', evaluating: '评价中', ready_report: '可以生成报告', completed: '已完成', failed: '步骤失败' };
  const DIMENSIONS = { accuracy: '准确性', logic: '逻辑', authenticity: '资料一致性', job_match: '岗位匹配', expression: '表达' };
  const state = { config: null, uploaded: null, session: null, history: [], busy: false, drafts: new Map(), reviews: new Map(), requests: new Map(), poll: null, pollError: false };

  function storageRead(storage, key) {
    try { return storage.getItem(key); }
    catch (error) { console.warn('Browser storage unavailable:', error.name); return null; }
  }
  function storageWrite(storage, key, value) {
    try { if (value) storage.setItem(key, value); else storage.removeItem(key); }
    catch (error) { console.warn('Browser storage unavailable; state is not persisted:', error.name); }
  }
  function el(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined && text !== null) node.textContent = String(text);
    if (className) node.className = className;
    return node;
  }
  function showError(error) {
    $('appError').textContent = typeof error === 'string' ? error : error.message || '操作失败，请检查服务连接后重试。';
    $('appError').hidden = false;
  }
  function clearError() { $('appError').hidden = true; $('appError').textContent = ''; }
  function formatTime(value) {
    if (!value) return '';
    const parsed = new Date(typeof value === 'number' && value < 1e12 ? value * 1000 : value);
    return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString('zh-CN', { hour12: false });
  }
  function number(value, digits = 1) { return Number.isFinite(Number(value)) ? Number(value).toFixed(digits).replace(/\.0$/, '') : '—'; }
  function textList(parent, title, values, emptyText = '暂无记录') {
    parent.append(el('h3', title));
    if (!Array.isArray(values) || !values.length) { parent.append(el('p', emptyText, 'muted')); return; }
    const list = el('ul', null, 'content-list');
    values.forEach((value) => list.append(el('li', value)));
    parent.append(list);
  }
  function details(parent, title, text) {
    const box = el('details'); box.append(el('summary', title), el('p', text, 'prose')); parent.append(box); return box;
  }
  function scoreDimensions(parent, scores) {
    const grid = el('dl', null, 'dimension-grid');
    Object.entries(DIMENSIONS).forEach(([key, label]) => {
      const item = el('div', null, 'dimension');
      item.append(el('dt', label), el('dd', `${number(scores?.[key])} / 5`)); grid.append(item);
    });
    parent.append(grid);
  }

  async function api(path, { method = 'GET', body, timeout = 300000, publicRequest = false } = {}) {
    const headers = {};
    const token = storageRead(sessionStorage, 'interviewAccessToken');
    if (token && !publicRequest) headers['X-Agent-Token'] = token;
    if (body !== undefined && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(`/api/agent${path}`, { method, headers, body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body), signal: controller.signal });
      if (response.status === 204) return null;
      let result;
      try { result = await response.json(); }
      catch (error) { throw new Error(`服务返回了无法读取的响应（HTTP ${response.status}），请查看后台日志。`, { cause: error }); }
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) $('tokenPanel').hidden = false;
        const detail = result?.detail;
        const message = Array.isArray(detail) ? detail.map((item) => `${(item.loc || []).join('.')}: ${item.msg}`).join('\n') : typeof detail === 'string' ? detail : detail?.message || `请求失败（HTTP ${response.status}）`;
        const error = new Error(message); error.code = detail?.code; throw error;
      }
      return result;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('请求等待超时。后台可能仍在执行；请稍后刷新历史查看状态，不要反复创建会话。', { cause: error });
      if (error instanceof TypeError) throw new Error('暂时无法连接服务。请确认后台已启动，网络恢复后重试。', { cause: error });
      throw error;
    } finally { clearTimeout(timer); }
  }

  function updateButtons() {
    document.querySelectorAll('[data-lock]').forEach((button) => { button.disabled = state.busy; });
    $('createButton').disabled = state.busy || !state.uploaded || !state.config;
    $('answerButton').disabled = state.busy || state.session?.status !== 'awaiting_answer' || !state.session?.current_question;
    $('answerInput').disabled = $('answerButton').disabled;
    $('finishButton').disabled = state.busy || !state.session?.turns?.length || !['awaiting_answer', 'ready_report'].includes(state.session?.status);
    document.querySelectorAll('.review-submit, .review-answer').forEach((input) => { input.disabled = state.busy || !['awaiting_answer', 'ready_report', 'completed'].includes(state.session?.status); });
  }
  function setBusy(value, message = '') {
    state.busy = value;
    $('loadingStatus').textContent = message;
    $('loadingStatus').classList.toggle('busy', value);
    document.querySelector('.agent-main').setAttribute('aria-busy', String(value));
    updateButtons();
  }
  function stopPolling() { if (state.poll) clearTimeout(state.poll); state.poll = null; }
  function startPolling() {
    stopPolling(); state.pollError = false;
    const tick = async () => {
      if (!state.busy || !state.session?.id) return;
      const id = state.session.id;
      try {
        const session = await api(`/sessions/${encodeURIComponent(id)}`, { timeout: 10000 });
        if (state.busy && state.session?.id === id) renderWorkflow(session);
      } catch (error) {
        if (!state.pollError) { console.warn('Progress polling failed:', error.message); state.pollError = true; }
        $('loadingStatus').textContent = '仍在等待操作结果；暂时无法读取进度，请勿重复提交。';
      }
      if (state.busy) state.poll = setTimeout(tick, 1000);
    };
    state.poll = setTimeout(tick, 1000);
  }
  async function action(message, task, { poll = false } = {}) {
    if (state.busy) return;
    clearError(); setBusy(true, message);
    if (poll) startPolling();
    let succeeded = false;
    try { await task(); succeeded = true; }
    catch (error) { showError(error); }
    finally {
      stopPolling();
      // A final poll may have observed an earlier node while the action completed.
      renderWorkflow(state.session);
      const failed = state.session?.status === 'failed';
      setBusy(false, succeeded ? failed ? '本步骤未完成，已保存会话。请查看错误并重试。' : state.session?.status === 'running' ? '后台仍在执行。稍后点击“刷新”可更新当前会话进度，请勿重复提交。' : '操作完成。可以继续下一步。' : '操作未完成，输入内容已保留。');
    }
  }
  function saveDrafts() {
    if (state.session?.current_question) state.drafts.set(`${state.session.id}:${state.session.current_question.id}`, $('answerInput').value);
    document.querySelectorAll('.review-form').forEach((form) => state.reviews.set(`${state.session?.id}:${form.dataset.turnId}`, form.querySelector('textarea').value));
  }
  function setSession(session) {
    saveDrafts(); state.session = session;
    storageWrite(localStorage, 'interviewLastSessionId', session?.id || '');
    renderWorkflow(session); renderAnalysis(session); renderInterview(session); renderReview(session); renderReport(session); renderHistory(); updateButtons();
  }
  function renderWorkflow(session) {
    const stages = state.config?.stages?.length ? state.config.stages : Object.keys(STAGES);
    const events = session?.events || [];
    const completed = new Set(events.filter((event) => ['completed', 'success', 'done'].includes(event.status)).map((event) => event.stage));
    const list = $('stageList'); list.replaceChildren();
    stages.forEach((stage) => {
      const item = el('li', STAGES[stage] || stage);
      if (completed.has(stage)) item.classList.add('done');
      if (session?.stage === stage) { item.classList.add('active'); item.setAttribute('aria-current', 'step'); if (session.status === 'failed') item.classList.add('failed'); }
      list.append(item);
    });
    $('sessionHeading').textContent = session?.title || '2. 分析与练习';
    $('sessionStatus').textContent = STATUS[session?.status] || session?.status || '未开始';
    $('sessionMeta').textContent = session ? `${session.mode === 'mock' ? 'Mock 演示 · 规则模拟，不是真实模型评分' : '模型模式'} · 创建于 ${formatTime(session.created_at)}` : '上传简历并填写 JD，或使用左侧脱敏示例开始。';
    $('traceDetails').hidden = !events.length;
    $('eventList').replaceChildren(...events.map((event) => el('li', `${formatTime(event.time)} · ${STAGES[event.stage] || event.stage} · ${{ completed: '完成', success: '完成', done: '完成', started: '开始', running: '执行中', failed: '失败' }[event.status] || event.status}`)));
    $('retryButton').hidden = session?.status !== 'failed';
    $('prepareButton').hidden = !['uploaded', 'created'].includes(session?.status);
    $('sessionError').hidden = !session?.error;
    $('sessionError').textContent = session?.error ? `${STAGES[session.error.stage] || session.error.stage || '当前步骤'}：${session.error.message || '处理失败'}${session.error.code ? `（${session.error.code}）` : ''}` : '';
  }
  function renderAnalysis(session) {
    const analysis = session?.analysis;
    $('analysisPanel').hidden = !analysis;
    const content = $('analysisContent'); content.replaceChildren();
    const structured = $('structuredContent'); structured.replaceChildren();
    if (!analysis) return;
    const score = el('div', null, 'score-overview'); score.append(el('span', number(analysis.score), 'score-number'), el('span', '/ 100 · 岗位匹配参考分，不是录用概率', 'score-description')); content.append(score, el('p', analysis.summary, 'prose'));
    textList(content, '匹配点与依据', (analysis.matched || []).map((item) => `${item.requirement}：${item.reason}${item.evidence ? `\n简历依据：${item.evidence}` : ''}`), '未发现充分支持的匹配点');
    textList(content, '需要补足的能力', analysis.gaps, '暂未列出短板，不代表全部满足岗位要求');
    textList(content, '准备建议', analysis.suggestions);
    const resume = session.resume || session.resume_parsed;
    if (resume) {
      textList(structured, '教育经历', (resume.education || []).map((item) => [item.school, item.degree, item.major, `${item.start_date || ''}—${item.end_date || ''}`].filter(Boolean).join(' · ')));
      textList(structured, '技能', resume.skills);
      ['internships', 'projects'].forEach((key) => textList(structured, key === 'projects' ? '项目经历' : '实习经历', (resume[key] || []).map((item) => `${item.title || ''}${item.organization ? ` · ${item.organization}` : ''}${item.role ? ` · ${item.role}` : ''}\n${item.summary || ''}${item.evidence ? `\n原文依据：${item.evidence}` : ''}`), '简历中未提取到明确记录'));
      if (resume.warnings?.length) textList(structured, '简历解析提醒', resume.warnings);
    }
    if (session.jd_parsed) {
      textList(structured, '岗位要求', (session.jd_parsed.requirements || []).map((item) => `${item.priority === 'preferred' ? '加分项' : '主要要求'} · ${item.topic}：${item.description}`));
      if (session.jd_parsed.warnings?.length) textList(structured, '岗位解析提醒', session.jd_parsed.warnings);
    }
  }
  function renderEvaluation(parent, evaluation, score) {
    if (!evaluation) return;
    if (score !== undefined) parent.append(el('p', `本次回答参考分：${number(score)} / 100`, 'score'));
    scoreDimensions(parent, evaluation.scores);
    parent.append(el('p', evaluation.rationale, 'prose'));
    textList(parent, '做得好的地方', evaluation.strengths);
    textList(parent, '下一次可以改进', evaluation.improvements);
    parent.append(el('p', evaluation.authenticity_note, 'muted'));
    details(parent, '查看参考答题思路（请勿冒充未做过的经历）', evaluation.reference_answer);
  }
  function renderInterview(session) {
    const questions = session?.questions || [];
    const turns = session?.turns || [];
    $('interviewPanel').hidden = !questions.length && !turns.length;
    const question = session?.current_question;
    $('questionCard').hidden = !question;
    $('answerForm').hidden = !question || session?.status === 'completed';
    $('noQuestion').hidden = session?.status !== 'ready_report';
    $('finishButton').hidden = session?.status === 'completed';
    $('answerProgress').textContent = `已回答 ${turns.length} 题（含追问） · 基础题 ${questions.filter((item) => !item.parent_id).length} 题`;
    $('currentQuestion').textContent = question?.prompt || '';
    $('questionMeta').textContent = question ? `${question.parent_id ? '继续追问' : question.level} · ${question.topic}` : '';
    $('questionEvidence').textContent = question?.evidence ? `提问依据：${question.evidence}` : '';
    $('answerInput').value = question ? state.drafts.get(`${session.id}:${question.id}`) || (session.pending?.kind === 'answer' && session.pending.question_id === question.id ? session.pending.answer : '') || '' : '';
    const list = $('turnList'); list.replaceChildren();
    if (turns.length) list.append(el('h3', '回答与评价记录'));
    [...turns].reverse().forEach((turn, index) => {
      const card = el('details', null, 'evaluation-card'); card.dataset.turnId = turn.id;
      card.open = index === 0 && session.status !== 'completed';
      const prompt = turn.question?.prompt || turn.question || '面试回答';
      card.append(el('summary', `${turns.length - index}. ${prompt} · ${number(turn.score)} / 100`));
      details(card, '查看我的原回答', turn.answer);
      renderEvaluation(card, turn.evaluation, turn.score);
      list.append(card);
    });
  }
  function renderReview(session) {
    const weakPoints = session?.weak_points || [];
    $('reviewPanel').hidden = !weakPoints.length;
    const tags = $('weakPointList'); tags.replaceChildren();
    weakPoints.forEach((point) => tags.append(el('span', `${point.topic}${point.reviewed ? ' · 已复习' : ' · 待复习'}`, `weak-tag${point.reviewed ? ' reviewed' : ''}`)));
    const list = $('reviewList'); list.replaceChildren();
    const ids = new Set(weakPoints.flatMap((point) => point.turn_ids || []));
    (session?.turns || []).filter((turn) => ids.has(turn.id)).forEach((turn) => {
      const box = el('details', null, 'review-item');
      box.append(el('summary', turn.question?.prompt || '复习本题'));
      box.append(el('p', `原回答：${turn.answer}`, 'prose original-answer'));
      textList(box, '原评价提示', turn.evaluation?.improvements);
      const form = el('form', null, 'review-form'); form.dataset.turnId = turn.id;
      const label = el('label', '重新回答'); const input = el('textarea', null, 'review-answer');
      input.id = `review-${turn.id}`; input.rows = 4; input.maxLength = state.config?.limits?.max_answer_chars || 10000; input.required = true; input.dataset.lock = '';
      input.value = state.reviews.get(`${session.id}:${turn.id}`) || (session.pending?.kind === 'review' && session.pending.turn_id === turn.id ? session.pending.answer : '') || ''; label.htmlFor = input.id;
      const button = el('button', '提交复习并重新评价', 'review-submit'); button.type = 'submit'; button.dataset.lock = '';
      form.append(label, input, button);
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        const answer = input.value.trim(); if (!answer) { showError('请先填写复习回答。'); return; }
        const requestId = requestFor(`review:${session.id}:${turn.id}`, answer);
        action('正在评价复习回答……', async () => {
          const result = await api(`/sessions/${encodeURIComponent(session.id)}/review`, { method: 'POST', body: { turn_id: turn.id, answer, request_id: requestId } });
          setSession(result); await loadHistory();
          if (result.status !== 'failed') { state.requests.delete(`review:${session.id}:${turn.id}`); }
        }, { poll: true });
      });
      box.append(form);
      const reviews = (session.reviews || []).filter((review) => review.turn_id === turn.id);
      reviews.forEach((review, index) => {
        const result = el('div', null, 'evaluation-card'); result.append(el('h3', `复习 ${index + 1} · ${formatTime(review.created_at)}`));
        details(result, '查看本次复习回答', review.answer); renderEvaluation(result, review.evaluation, review.score); box.append(result);
      });
      list.append(box);
    });
  }
  function renderReport(session) {
    const report = session?.report;
    $('reportPanel').hidden = !report;
    const content = $('reportContent'); content.replaceChildren();
    if (!report) return;
    content.append(el('h3', session.title), el('p', `${session.mode === 'mock' ? 'Mock 演示报告 · ' : ''}${formatTime(report.generated_at)} · 已回答 ${report.answered ?? session.turns?.length ?? 0} 题`, 'muted'));
    const score = el('div', null, 'score-overview'); score.append(el('span', number(report.average_score), 'score-number'), el('span', '/ 100 · 回答平均参考分', 'score-description')); content.append(score);
    scoreDimensions(content, report.dimensions);
    content.append(el('p', report.summary, 'prose'));
    textList(content, '优势', report.strengths); textList(content, '后续练习建议', report.improvements);
    textList(content, '薄弱知识点', (report.weak_points || []).map((point) => typeof point === 'string' ? point : `${point.topic}${point.reviewed ? '（已复习）' : ''}`), '本轮未记录薄弱知识点，不代表已掌握全部知识');
    content.append(el('p', report.disclaimer || '报告仅供学习参考，不能验证经历真实性或预测录用结果。', 'notice'));
  }
  function renderHistory() {
    const list = $('historyList'); list.replaceChildren();
    if (!state.history.length) { list.append(el('p', '还没有面试记录。完成左侧准备即可开始。', 'muted')); return; }
    state.history.forEach((item) => {
      const card = el('article', null, `history-item${state.session?.id === item.id ? ' current' : ''}`); card.dataset.sessionId = item.id;
      card.append(el('h3', item.title || '模拟面试'), el('p', `${STATUS[item.status] || item.status} · ${item.mode === 'mock' ? 'Mock' : '模型'} · 已答 ${item.answered ?? 0} 题`, 'muted'), el('p', formatTime(item.updated_at || item.created_at), 'muted'));
      const buttons = el('div', null, 'history-actions');
      const open = el('button', '打开', 'open-session'); open.type = 'button'; open.dataset.lock = '';
      open.addEventListener('click', () => action('正在打开面试记录……', async () => setSession(await api(`/sessions/${encodeURIComponent(item.id)}`))));
      const remove = el('button', '删除', 'delete-session danger'); remove.type = 'button'; remove.dataset.lock = '';
      remove.addEventListener('click', () => {
        if (!window.confirm(`删除“${item.title || '模拟面试'}”及其回答、评分和报告？删除后无法恢复。`)) return;
        action('正在删除指定面试记录……', async () => {
          await api(`/sessions/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
          if (state.session?.id === item.id) setSession(null);
          await loadHistory();
        });
      });
      buttons.append(open, remove); card.append(buttons); list.append(card);
    });
  }
  async function loadHistory() {
    state.history = await api('/sessions'); renderHistory(); updateButtons();
  }
  function requestFor(key, answer) {
    const old = state.requests.get(key);
    if (old?.answer === answer) return old.id;
    const id = crypto.randomUUID(); state.requests.set(key, { answer, id }); return id;
  }
  function setUploaded(resume) {
    state.uploaded = resume;
    $('resumeStatus').textContent = `已准备：${resume.filename || '脱敏示例简历'}${resume.text ? ` · ${resume.text.length} 字符` : ''}`;
    $('resumePreview').hidden = !resume.text; $('resumeText').textContent = resume.text || ''; updateButtons();
  }

  $('uploadForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const file = $('resumeFile').files[0];
    if (!file) { showError('请先选择 PDF 或 DOCX 文件。'); return; }
    if (!/\.(pdf|docx)$/i.test(file.name)) { showError('仅支持 PDF 或 DOCX 简历。'); return; }
    const limit = state.config?.limits?.max_upload_bytes || 12 * 1024 * 1024;
    if (!file.size || file.size > limit) { showError(`文件不能为空，且不能超过 ${number(limit / 1024 / 1024)} MB。`); return; }
    action('正在校验文件并提取简历文字……', async () => { const body = new FormData(); body.append('file', file); setUploaded(await api('/resumes', { method: 'POST', body })); });
  });
  $('demoButton').addEventListener('click', () => action('正在准备脱敏演示材料……', async () => {
    const sample = await api('/demo');
    const demo = await api('/demo', { method: 'POST' });
    setUploaded({ id: demo.resume_id, filename: '脱敏示例简历', text: sample.resume_text });
    $('jdInput').value = demo.jd; $('sessionTitle').value = demo.title || '脱敏示例 · 模拟面试';
  }));
  $('createSessionForm').addEventListener('submit', (event) => {
    event.preventDefault();
    if (!state.uploaded) { showError('请上传简历，或先使用脱敏示例。'); return; }
    if (!state.config?.is_mock && !$('externalConsent').checked) { showError('当前使用外部模型，请确认资料发送授权，或由部署者切换为 Mock 模式。'); return; }
    const jd = $('jdInput').value.trim();
    if (jd.length < 20) { showError('请填写至少 20 个字符的岗位职责与任职要求。'); return; }
    action('正在保存材料并分析简历与岗位……', async () => {
      const session = await api('/sessions', { method: 'POST', body: { resume_id: state.uploaded.id, jd, title: $('sessionTitle').value.trim() || '模拟面试', question_count: Number($('questionCount').value), allow_external_model: !state.config.is_mock && $('externalConsent').checked } });
      setSession(session); startPolling();
      setSession(await api(`/sessions/${encodeURIComponent(session.id)}/prepare`, { method: 'POST' }));
      await loadHistory();
    });
  });
  $('prepareButton').addEventListener('click', () => action('正在继续解析材料……', async () => { setSession(await api(`/sessions/${encodeURIComponent(state.session.id)}/prepare`, { method: 'POST' })); await loadHistory(); }, { poll: true }));
  $('retryButton').addEventListener('click', () => action('正在重试失败的节点，已保存的数据不会重建……', async () => { setSession(await api(`/sessions/${encodeURIComponent(state.session.id)}/retry`, { method: 'POST' })); await loadHistory(); }, { poll: true }));
  $('answerForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const session = state.session; const question = session?.current_question;
    const answer = $('answerInput').value.trim();
    if (!question || !answer) { showError('请先填写当前问题的回答。'); return; }
    const key = `answer:${session.id}:${question.id}`;
    const requestId = requestFor(key, answer);
    action('正在评价回答并判断是否需要追问……', async () => {
      const result = await api(`/sessions/${encodeURIComponent(session.id)}/answer`, { method: 'POST', body: { question_id: question.id, answer, request_id: requestId } });
      setSession(result); await loadHistory();
      if (result.status !== 'failed') { state.requests.delete(key); state.drafts.delete(`${session.id}:${question.id}`); }
    }, { poll: true });
  });
  $('finishButton').addEventListener('click', () => {
    if (state.session?.status === 'awaiting_answer' && !window.confirm('还有未回答的问题。现在结束，并根据已有回答生成报告吗？')) return;
    action('正在汇总本轮回答与薄弱点……', async () => { setSession(await api(`/sessions/${encodeURIComponent(state.session.id)}/finish`, { method: 'POST' })); await loadHistory(); $('reportPanel').scrollIntoView({ behavior: 'smooth', block: 'start' }); }, { poll: true });
  });
  $('refreshHistory').addEventListener('click', () => action('正在刷新历史与当前会话……', async () => {
    await loadHistory();
    if (state.session && state.history.some((item) => item.id === state.session.id)) setSession(await api(`/sessions/${encodeURIComponent(state.session.id)}`));
  }));
  $('exportReport').addEventListener('click', () => {
    if (!state.session?.report) return;
    const exportData = { title: state.session.title, mode: state.session.mode, report: state.session.report };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob); const link = el('a'); link.href = url; link.download = `interview-report-${state.session.id}.json`; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  $('printReport').addEventListener('click', () => { if (state.session?.report) window.print(); });
  $('tokenForm').addEventListener('submit', (event) => {
    event.preventDefault(); storageWrite(sessionStorage, 'interviewAccessToken', $('tokenInput').value.trim()); $('tokenInput').value = '';
    action('正在验证访问令牌……', async () => { await loadHistory(); const last = storageRead(localStorage, 'interviewLastSessionId'); if (last && state.history.some((item) => item.id === last)) setSession(await api(`/sessions/${encodeURIComponent(last)}`)); });
  });
  $('forgetToken').addEventListener('click', () => {
    storageWrite(sessionStorage, 'interviewAccessToken', ''); state.history = []; state.uploaded = null; setSession(null);
    state.drafts.clear(); state.reviews.clear(); state.requests.clear();
    $('tokenInput').value = ''; $('resumeFile').value = ''; $('jdInput').value = ''; $('sessionTitle').value = ''; $('externalConsent').checked = false;
    renderHistory(); updateButtons(); clearError(); $('resumeStatus').textContent = '尚未上传简历'; $('resumePreview').hidden = true; $('resumeText').textContent = ''; $('loadingStatus').textContent = '已清除访问令牌及本页临时内容；服务端历史未删除，重新连接后可以读取。';
  });
  window.addEventListener('beforeunload', (event) => { if (state.busy) { event.preventDefault(); event.returnValue = ''; } });

  action('正在连接服务……', async () => {
    state.config = await api('/config', { publicRequest: true, timeout: 15000 });
    const config = state.config;
    $('modeBadge').textContent = config.is_mock ? 'Mock · 无需 API Key' : `${config.provider} · ${config.model}`;
    $('modeBadge').classList.toggle('mock', Boolean(config.is_mock));
    $('modeNotice').textContent = config.is_mock ? '当前为 Mock 演示模式：使用确定性规则展示解析、问题、评分、追问与复习流程，不调用大模型；演示分数不代表真实能力测评。' : `当前使用 ${config.provider} / ${config.model}。开始分析后，简历文本、岗位要求与回答会发送到部署者配置的模型服务。API Key 仅由后台环境变量管理，网页无需填写。`;
    $('externalConsentLabel').hidden = Boolean(config.is_mock);
    $('tokenPanel').hidden = !config.requires_token;
    $('jdInput').maxLength = config.limits?.max_jd_chars || 30000;
    $('answerInput').maxLength = config.limits?.max_answer_chars || 10000;
    renderWorkflow(null);
    if (config.requires_token && !storageRead(sessionStorage, 'interviewAccessToken')) { renderHistory(); return; }
    await loadHistory();
    const last = storageRead(localStorage, 'interviewLastSessionId');
    if (last && state.history.some((item) => item.id === last)) setSession(await api(`/sessions/${encodeURIComponent(last)}`));
  });
})();
