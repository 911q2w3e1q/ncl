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

/** 当前 AI 模式（cloud / local） */
let aiMode = 'cloud';
/** 本地模型列表缓存 */
let aiLocalModels = [];
/** 正在下载的模型 id */
let aiDownloading = '';

/** 格式化字节数 */
function aiFmtSize(n) {
  const v = Number(n) || 0;
  if (v >= 1024 * 1024 * 1024) return `${(v / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (v >= 1024 * 1024) return `${Math.round(v / 1024 / 1024)} MB`;
  if (v >= 1024) return `${Math.round(v / 1024)} KB`;
  return `${v} B`;
}

/** 切换设置页的显示（云端 / 本地） */
function aiApplyModeUI() {
  const local = aiMode === 'local';
  const box = $('sp-ai-local-box');
  const base = $('sp-ai-baseurl-card');
  const key = $('sp-ai-apikey-card');
  const model = $('sp-ai-model-card');
  const cloud = $('sp-ai-cloud-box');
  if (box) box.hidden = !local;
  if (cloud) cloud.hidden = local;
  if (base) base.hidden = local;
  if (key) key.hidden = local;
  if (model) model.hidden = local;
  // 模式分段按钮高亮
  const seg = $('sp-ai-mode');
  if (seg) {
    for (const b of seg.querySelectorAll('.seg-item')) {
      b.classList.toggle('seg-active', b.dataset.mode === aiMode);
    }
  }
  const auto = $('sp-ai-auto');
  const autoCard = auto && auto.closest ? auto.closest('.set-card') : null;
  if (autoCard) autoCard.hidden = false;
}

/** 渲染本地模型列表 */
function aiRenderLocalModels() {
  const wrap = $('sp-ai-model-list');
  if (!wrap) return;
  wrap.innerHTML = '';
  if (!aiLocalModels.length) {
    const d = document.createElement('div');
    d.className = 'ai-model-empty';
    d.textContent = '正在读取模型列表…';
    wrap.appendChild(d);
    return;
  }
  for (const m of aiLocalModels) {
    const row = document.createElement('div');
    row.className = 'ai-model-row' + (m.id === aiLocalCurrentId ? ' ai-model-active' : '');

    const info = document.createElement('div');
    info.className = 'ai-model-info';
    const name = document.createElement('div');
    name.className = 'ai-model-name';
    name.textContent = m.label;
    const meta = document.createElement('div');
    meta.className = 'ai-model-meta';
    meta.textContent = `${m.params} · ${aiFmtSize(m.size)}`;
    const note = document.createElement('div');
    note.className = 'ai-model-note';
    note.textContent = m.installed ? '已下载到本地' : m.note;
    info.append(name, meta, note);

    const act = document.createElement('div');
    act.className = 'ai-model-act';
    if (m.installed) {
      const use = document.createElement('button');
      use.className = 'btn-ghost btn-sm' + (m.id === aiLocalCurrentId ? ' ai-btn-picked' : '');
      use.textContent = m.id === aiLocalCurrentId ? '已选用' : '选用';
      use.onclick = async () => {
        aiLocalCurrentId = m.id;
        await aiSaveConfig(true);
        await aiLoadLocalModels();
        toast(`已选用本地模型：${m.label}`);
      };
      const del = document.createElement('button');
      del.className = 'btn-ghost btn-sm ai-btn-danger';
      del.textContent = '删除';
      del.onclick = async () => {
        if (!confirm(`确定删除本地模型「${m.label}」？`)) return;
        const r = await api('ai:localRemove', { modelId: m.id });
        if (r && r.ok) {
          toast('已删除本地模型');
          await aiLoadLocalModels();
        } else {
          toast('删除失败：' + ((r && r.error) || '未知原因'));
        }
      };
      act.append(use, del);
    } else if (aiDownloading === m.id) {
      const bar = document.createElement('div');
      bar.className = 'ai-model-progress';
      const fill = document.createElement('div');
      fill.className = 'ai-model-progress-fill';
      fill.style.width = `${aiDownloadPercent}%`;
      bar.appendChild(fill);
      const txt = document.createElement('span');
      txt.className = 'ai-model-progress-text';
      txt.textContent = `下载中 ${aiDownloadPercent}%`;
      act.append(bar, txt);
    } else {
      const dl = document.createElement('button');
      dl.className = 'btn btn-sm';
      dl.textContent = `下载（${aiFmtSize(m.size)}）`;
      dl.onclick = () => aiDownloadLocalModel(m);
      act.appendChild(dl);
    }
    row.append(info, act);
    wrap.appendChild(row);
  }
}

/** 下载本地模型 */
let aiDownloadPercent = 0;
async function aiDownloadLocalModel(m) {
  if (aiDownloading) { toast('已有模型正在下载，请稍候'); return; }
  aiDownloading = m.id;
  aiDownloadPercent = 0;
  aiRenderLocalModels();
  try {
    const r = await api('ai:localDownload', { modelId: m.id });
    if (r && r.ok) {
      toast(`模型「${m.label}」下载完成`);
      aiLocalCurrentId = m.id;
      await aiSaveConfig(true);
    } else {
      toast('下载失败：' + ((r && r.error) || '未知原因'));
    }
  } catch (e) {
    toast('下载失败：' + (e.message || String(e)));
  } finally {
    aiDownloading = '';
    aiDownloadPercent = 0;
    await aiLoadLocalModels();
  }
}

/** 拉取本地模型列表 */
let aiLocalCurrentId = '';
async function aiLoadLocalModels() {
  try {
    const r = await api('ai:localModels');
    if (r && r.ok) {
      aiLocalModels = r.models || [];
      aiLocalCurrentId = r.current || aiLocalCurrentId;
      if (aiMode === 'local') aiRenderLocalModels();
    }
  } catch { /* 忽略 */ }
}

async function aiLoadConfig() {
  try {
    const cfg = await api('ai:getConfig');
    aiMode = (cfg && cfg.mode) === 'local' ? 'local' : 'cloud';
    aiLocalCurrentId = (cfg && cfg.localModelId) || aiLocalCurrentId;
    $('sp-ai-enabled').checked = !!(cfg && cfg.enabled);
    $('sp-ai-auto').checked = !(cfg && cfg.autoAnalyze === false);
    $('sp-ai-baseurl').value = (cfg && cfg.baseUrl) || '';
    $('sp-ai-model').value = (cfg && cfg.model) || '';
    $('sp-ai-apikey').value = '';
    $('sp-ai-apikey').placeholder = (cfg && cfg.apiKeyMasked) ? `${cfg.apiKeyMasked}（留空表示不修改）` : 'sk-…';
    const res = $('sp-ai-test-result');
    if (res) {
      res.textContent = aiMode === 'local'
        ? '本地模式无需 API Key'
        : ((cfg && cfg.hasKey) ? '已配置' : '未配置 API Key');
    }
    aiApplyModeUI();
    await aiLoadLocalModels();
  } catch (e) {
    $('sp-ai-test-result').textContent = '读取失败：' + e.message;
  }
}

async function aiSaveConfig(silent) {
  const patch = {
    enabled: $('sp-ai-enabled').checked,
    autoAnalyze: $('sp-ai-auto').checked,
    mode: aiMode,
    baseUrl: $('sp-ai-baseurl').value.trim(),
    model: $('sp-ai-model').value.trim(),
  };
  if (aiMode === 'local') patch.localModelId = aiLocalCurrentId;
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
      toast(aiMode === 'local' ? '本地模型可用' : 'AI 接口连接成功');
    } else {
      el.textContent = '失败：' + ((r && r.error) || '未知原因');
      toast(aiMode === 'local' ? '本地模型不可用' : 'AI 接口连接失败');
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

  // AI 模式切换（云端 / 本地）
  const seg = $('sp-ai-mode');
  if (seg) {
    for (const b of seg.querySelectorAll('.seg-item')) {
      b.addEventListener('click', async () => {
        const mode = b.dataset.mode === 'local' ? 'local' : 'cloud';
        if (mode === aiMode) return;
        aiMode = mode;
        aiApplyModeUI();
        if (mode === 'local') {
          aiRenderLocalModels();
          await aiLoadLocalModels();
          aiRenderLocalModels();
        }
        await aiSaveConfig(true);
      });
    }
  }

  // 本地模型下载进度
  onEvent('launcher://ai-local-progress', (payload) => {
    if (!payload || !payload.modelId) return;
    if (payload.modelId !== aiDownloading) return;
    if (typeof payload.percent === 'number') aiDownloadPercent = payload.percent;
    if (aiMode === 'local') aiRenderLocalModels();
  });

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
