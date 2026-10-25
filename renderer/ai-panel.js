/* NCL 渲染层：AI 报错分析面板
 * 负责：
 *  - 打开分析弹窗、渲染模型给出的原因与解决方案
 *  - 「帮我解决」按钮 → 调用主进程执行动作 → 应用成功后自动重启游戏验证
 *  - 设置页 AI 配置的读写与连通性测试
 */
'use strict';

const ai = {
  analyzing: false,
  analysis: null,
  versionId: '',
  applying: false,
};

/* ---------------- 分析弹窗 ---------------- */

function aiShowLoading(text) {
  $('ai-status').hidden = false;
  $('ai-status-text').textContent = text || '正在分析崩溃原因…';
  $('ai-error').hidden = true;
  $('ai-result').hidden = true;
  $('ai-btn-retry').hidden = true;
}

function aiShowError(msg) {
  $('ai-status').hidden = true;
  $('ai-result').hidden = true;
  $('ai-error').hidden = false;
  $('ai-error').textContent = msg || '分析失败';
  $('ai-btn-retry').hidden = false;
}

const AI_RISK_TEXT = { low: '低风险', medium: '中风险', high: '高风险' };

function aiRenderResult(analysis, versionId) {
  ai.analysis = analysis || {};
  ai.versionId = versionId || ai.versionId;
  $('ai-status').hidden = true;
  $('ai-error').hidden = true;
  $('ai-result').hidden = false;
  $('ai-btn-retry').hidden = false;

  $('ai-summary').textContent = analysis.summary || '（模型未给出结论）';
  const conf = analysis.confidence || 'medium';
  const confEl = $('ai-confidence');
  confEl.textContent = { high: '把握较大', medium: '把握一般', low: '把握较小' }[conf] || conf;
  confEl.className = 'ai-confidence ai-conf-' + conf;

  // 原因
  const causes = Array.isArray(analysis.causes) ? analysis.causes : [];
  $('ai-causes-wrap').hidden = !causes.length;
  $('ai-causes').innerHTML = '';
  for (const c of causes) {
    const d = document.createElement('div');
    d.className = 'ai-cause';
    d.innerHTML = `<div class="ai-cause-title"></div><div class="ai-cause-detail"></div>`;
    d.querySelector('.ai-cause-title').textContent = c.title || '原因';
    d.querySelector('.ai-cause-detail').textContent = c.detail || '';
    $('ai-causes').appendChild(d);
  }

  // 解决方案
  const sols = Array.isArray(analysis.solutions) ? analysis.solutions : [];
  $('ai-solutions-wrap').hidden = !sols.length;
  $('ai-solutions').innerHTML = '';
  if (!sols.length) {
    const d = document.createElement('div');
    d.className = 'ai-no-fix';
    d.textContent = '模型未给出可自动应用的修复方案，请参考上方原因手动排查。';
    $('ai-solutions').appendChild(d);
  }
  for (const s of sols) {
    const card = document.createElement('div');
    card.className = 'ai-solution';
    const head = document.createElement('div');
    head.className = 'ai-solution-head';
    const t = document.createElement('span');
    t.className = 'ai-solution-title';
    t.textContent = s.title || '解决方案';
    const r = document.createElement('span');
    r.className = 'ai-risk ai-risk-' + (s.risk || 'low');
    r.textContent = AI_RISK_TEXT[s.risk] || '低风险';
    head.append(t, r);
    card.appendChild(head);

    const detail = document.createElement('div');
    detail.className = 'ai-solution-detail';
    detail.textContent = s.detail || '';
    card.appendChild(detail);

    const actions = Array.isArray(s.actions) ? s.actions : [];
    if (actions.length) {
      const bar = document.createElement('div');
      bar.className = 'ai-solution-actions';
      const btn = document.createElement('button');
      btn.className = 'btn btn-sm ai-fix-btn';
      btn.textContent = '帮我解决';
      btn.onclick = () => aiApplySolution(actions, btn);
      const note = document.createElement('span');
      note.className = 'ai-fix-note';
      note.textContent = '将自动修改相关配置并重启游戏验证';
      bar.append(btn, note);
      card.appendChild(bar);
    }
    $('ai-solutions').appendChild(card);
  }
}

/** 打开分析弹窗并请求分析 */
async function aiAnalyze(trigger) {
  if (ai.analyzing) return;
  ai.analyzing = true;
  $('modal-ai').hidden = false;
  aiShowLoading(trigger === 'auto' ? '游戏崩溃了，正在自动分析原因…' : '正在分析报错原因…');
  try {
    const r = await api('ai:analyze', { trigger: trigger || 'manual' });
    if (!r || !r.ok) {
      aiShowError((r && r.error) || '分析失败');
      return;
    }
    aiRenderResult(r.analysis, (r.analysis && r.analysis.versionId) || (state && state.settings && state.settings.selectedVersionId) || '');
  } catch (e) {
    aiShowError(e.message || String(e));
  } finally {
    ai.analyzing = false;
  }
}

/** 「帮我解决」：执行动作 → 成功后自动重启游戏 */
async function aiApplySolution(actions, btn) {
  if (ai.applying) return;
  if (!Array.isArray(actions) || !actions.length) {
    toast('这个方案没有可自动执行的动作');
    return;
  }
  ai.applying = true;
  const old = btn.textContent;
  btn.disabled = true;
  btn.textContent = '正在处理…';
  try {
    const r = await api('ai:applyActions', { actions });
    const applied = (r && r.applied) || [];
    const failed = (r && r.failed) || [];
    if (!applied.length) {
      const msg = failed.length ? (failed[0].error || '执行失败') : '没有可执行的动作';
      toast('未能自动修复：' + msg);
      btn.textContent = old;
      btn.disabled = false;
      return;
    }
    // 展示变更
    const lines = applied.map((a) => a.description || (a.action && a.action.type));
    toast(`已应用 ${applied.length} 项修改：${lines[0]}${lines.length > 1 ? ' 等' : ''}`);
    if (failed.length) toast(`有 ${failed.length} 项未能应用：${failed[0].error || ''}`);

    // 自动重启游戏验证
    const vid = ai.versionId || (state && state.selectedVersionId);
    if (vid) {
      btn.textContent = '正在重启验证…';
      const la = await api('game:launch', vid);
      if (la && la.ok) {
        toast('已用新配置重启游戏');
      } else {
        toast('重启失败：' + ((la && la.error) || '未知原因'));
      }
    }
    closeModal('modal-ai');
  } catch (e) {
    toast('处理失败：' + (e.message || String(e)));
    btn.textContent = old;
    btn.disabled = false;
  } finally {
    ai.applying = false;
  }
}

/* ---------------- 设置页 AI 配置 ---------------- */

async function aiLoadConfig() {
  try {
    const cfg = await api('ai:getConfig');
    $('sp-ai-enabled').checked = !!(cfg && cfg.enabled);
    $('sp-ai-auto').checked = !(cfg && cfg.autoAnalyze === false);
    $('sp-ai-baseurl').value = (cfg && cfg.baseUrl) || '';
    $('sp-ai-model').value = (cfg && cfg.model) || '';
    $('sp-ai-apikey').value = '';
    $('sp-ai-apikey').placeholder = (cfg && cfg.apiKeyMasked) ? `${cfg.apiKeyMasked}（留空表示不修改）` : 'sk-…';
    $('sp-ai-test-result').textContent = (cfg && cfg.hasKey) ? '已配置' : '未配置 API Key';
  } catch (e) {
    $('sp-ai-test-result').textContent = '读取失败：' + e.message;
  }
}

async function aiSaveConfig(silent) {
  const patch = {
    enabled: $('sp-ai-enabled').checked,
    autoAnalyze: $('sp-ai-auto').checked,
    baseUrl: $('sp-ai-baseurl').value.trim(),
    model: $('sp-ai-model').value.trim(),
  };
  const key = $('sp-ai-apikey').value.trim();
  if (key) patch.apiKey = key;
  try {
    const r = await api('ai:setConfig', patch);
    if (!r || !r.ok) {
      toast('保存失败：' + ((r && r.error) || '未知原因'));
      return false;
    }
    if (!silent) toast('AI 配置已保存');
    await aiLoadConfig();
    await refresh();
    return true;
  } catch (e) {
    toast('保存失败：' + e.message);
    return false;
  }
}

async function aiTestConnection() {
  const el = $('sp-ai-test-result');
  el.textContent = '测试中…';
  const ok = await aiSaveConfig(true);
  if (!ok) { el.textContent = '保存失败'; return; }
  try {
    const r = await api('ai:test');
    if (r && r.ok) {
      el.textContent = r.message || '连接成功';
      toast('AI 接口连接成功');
    } else {
      el.textContent = '失败：' + ((r && r.error) || '未知原因');
      toast('AI 接口连接失败');
    }
  } catch (e) {
    el.textContent = '失败：' + e.message;
  }
}

/* ---------------- 绑定 ---------------- */

function bindAiPanel() {
  // 日志区「分析报错」
  const btn = $('btn-ai-analyze');
  if (btn) btn.addEventListener('click', () => aiAnalyze('manual'));

  // 弹窗重新分析
  const retry = $('ai-btn-retry');
  if (retry) retry.addEventListener('click', () => aiAnalyze('manual'));

  // 设置页
  $('sp-btn-ai-save').addEventListener('click', () => aiSaveConfig(false));
  $('sp-btn-ai-test').addEventListener('click', () => aiTestConnection());

  // 崩溃自动事件（主进程触发）
  onEvent('launcher://ai-analysis', (payload) => {
    if (!payload) return;
    if (payload.ok) {
      aiRenderResult(payload.analysis, payload.versionId);
      $('modal-ai').hidden = false;
    } else if (payload.trigger === 'auto') {
      aiShowError(payload.error || '自动分析失败');
      $('modal-ai').hidden = false;
    }
  });

  // 崩溃但未启用自动分析时，提示用户可以手动分析
  onEvent('launcher://game-crashed', () => {
    const hint = $('ai-analyze-hint');
    if (hint) {
      hint.textContent = '⚠ 游戏异常退出！点「分析报错」让 AI 排查原因';
      hint.classList.add('log-actions-warn');
    }
    toast('游戏异常退出，可点「分析报错」让 AI 排查');
  });
}
