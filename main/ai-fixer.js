/* NCL AI 修复动作执行器
 * 负责把模型给出的动作落到真实配置上：
 *  - 改启动器设置（内存 / JVM 参数 / Java 路径 / 分辨率 / 全屏 / 版本隔离 / 服务器地址）
 *  - 写文件（限定在游戏目录内，禁止绝对路径与 .. 逃逸）
 *  - 移除某个 JVM 参数
 *
 * 安全约束：
 *  1. 每次执行前对 settings.json 与目标文件做备份（.aibak），可一键回滚
 *  2. writeFile 的 target 必须是相对路径且解析后仍在游戏目录内
 *  3. 数值类动作做范围校验，非法直接拒绝并回报原因
 */
'use strict';
const fs = require('fs');
const path = require('path');

const BACKUP_SUFFIX = '.aibak';
const MAX_WRITE_BYTES = 512 * 1024;

const ALLOWED_TYPES = new Set([
  'setMemory', 'setJvmArgs', 'setJavaPath', 'setWidth', 'setHeight',
  'setFullscreen', 'setIsolation', 'removeJvmArg', 'writeFile', 'setServerAddress',
]);

/** 数值动作的合法范围 */
const NUM_RANGES = {
  setMemory: [256, 65536],
  setWidth: [320, 10000],
  setHeight: [240, 10000],
};

/** 把动作落到 settings 对象上（不落盘），返回变更描述 */
function applyToSettings(settings, action) {
  const isGlobal = action.target === '*' || !action.target;
  const scope = isGlobal ? 'global' : 'perVersion';
  if (!isGlobal) {
    if (!settings.perVersion[action.target]) settings.perVersion[action.target] = {};
  }
  const bucket = isGlobal ? settings.global : settings.perVersion[action.target];
  const v = action.value;

  switch (action.type) {
    case 'setMemory': {
      const n = parseInt(v, 10);
      if (!Number.isFinite(n) || n < NUM_RANGES.setMemory[0] || n > NUM_RANGES.setMemory[1]) {
        throw new Error(`内存值非法：${v}（允许 ${NUM_RANGES.setMemory[0]}–${NUM_RANGES.setMemory[1]} MB）`);
      }
      bucket.memory = n;
      return `内存上限改为 ${n} MB`;
    }
    case 'setJvmArgs': {
      const cur = String(bucket.jvmArgs || '').trim();
      const add = String(v || '').trim();
      if (!add) throw new Error('JVM 参数为空');
      const parts = cur ? cur.split(/\s+/) : [];
      for (const p of add.split(/\s+/).filter(Boolean)) if (!parts.includes(p)) parts.push(p);
      bucket.jvmArgs = parts.join(' ');
      return `JVM 参数更新为：${bucket.jvmArgs}`;
    }
    case 'removeJvmArg': {
      const key = String(v || '').trim();
      if (!key) throw new Error('要移除的 JVM 参数为空');
      const parts = String(bucket.jvmArgs || '').split(/\s+/).filter(Boolean).filter((p) => !p.includes(key));
      bucket.jvmArgs = parts.join(' ');
      return `移除 JVM 参数 ${key}，现为：${bucket.jvmArgs || '(空)'}`;
    }
    case 'setJavaPath': {
      const p = String(v || '').trim();
      if (!p) throw new Error('Java 路径为空');
      bucket.javaPath = p;
      return `Java 路径设为 ${p}`;
    }
    case 'setWidth': {
      const n = parseInt(v, 10);
      if (!Number.isFinite(n) || n < NUM_RANGES.setWidth[0] || n > NUM_RANGES.setWidth[1]) throw new Error(`宽度非法：${v}`);
      bucket.width = n;
      return `窗口宽度改为 ${n}`;
    }
    case 'setHeight': {
      const n = parseInt(v, 10);
      if (!Number.isFinite(n) || n < NUM_RANGES.setHeight[0] || n > NUM_RANGES.setHeight[1]) throw new Error(`高度非法：${v}`);
      bucket.height = n;
      return `窗口高度改为 ${n}`;
    }
    case 'setFullscreen': {
      const b = String(v).toLowerCase() === 'true';
      bucket.fullscreen = b;
      return `全屏设为 ${b ? '开' : '关'}`;
    }
    case 'setIsolation': {
      const b = String(v).toLowerCase() === 'true';
      bucket.isolation = b;
      return `版本隔离设为 ${b ? '开' : '关'}`;
    }
    case 'setServerAddress': {
      const a = String(v || '').trim();
      bucket.serverAddress = a;
      return `服务器地址设为 ${a || '(空)'}`;
    }
    default:
      throw new Error(`不支持的动作类型：${action.type}`);
  }
}

/** 校验 writeFile 的目标路径必须落在游戏目录内 */
function resolveSafePath(gameDir, rel) {
  const p = String(rel || '').trim();
  if (!p) throw new Error('文件路径为空');
  if (path.isAbsolute(p) || /^[a-zA-Z]:/.test(p)) throw new Error('只允许相对游戏目录的路径');
  const base = path.resolve(gameDir);
  const full = path.resolve(base, p);
  if (full !== base && !full.startsWith(base + path.sep)) throw new Error('路径越界，已拒绝');
  return full;
}

/**
 * 执行一批动作
 * @param {object} opts { actions, settings, gameDir, saveSettings, backupDir }
 * @returns {{ok:boolean, applied:Array, failed:Array, backupPath?:string}}
 */
function applyActions(opts) {
  const { actions, settings, gameDir } = opts;
  const save = opts.saveSettings;
  const backupDir = opts.backupDir;
  const applied = [];
  const failed = [];

  if (!Array.isArray(actions) || !actions.length) {
    return { ok: false, applied, failed: [{ action: null, error: '没有可执行的动作' }] };
  }

  // 备份 settings（写盘前）
  let backupPath = null;
  try {
    if (backupDir) {
      fs.mkdirSync(backupDir, { recursive: true });
      backupPath = path.join(backupDir, `settings-${Date.now()}${BACKUP_SUFFIX}`);
      fs.writeFileSync(backupPath, JSON.stringify(settings, null, 2));
    }
  } catch (e) {
    failed.push({ action: null, error: `备份设置失败：${e.message}` });
    return { ok: false, applied, failed, backupPath: null };
  }

  const cloned = JSON.parse(JSON.stringify(settings));

  for (const action of actions) {
    try {
      if (!action || !ALLOWED_TYPES.has(action.type)) {
        throw new Error(`不支持的动作类型：${action?.type}`);
      }
      if (action.type === 'writeFile') {
        const full = resolveSafePath(gameDir, action.target);
        const content = String(action.value ?? '');
        if (Buffer.byteLength(content, 'utf8') > MAX_WRITE_BYTES) {
          throw new Error(`文件内容过大（上限 ${MAX_WRITE_BYTES / 1024}KB）`);
        }
        // 已存在则先备份
        if (fs.existsSync(full) && backupDir) {
          const rel = path.relative(gameDir, full).replace(/[\\/]/g, '_');
          try {
            fs.copyFileSync(full, path.join(backupDir, `${rel}-${Date.now()}${BACKUP_SUFFIX}`));
          } catch { /* 备份失败不阻断 */ }
        }
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, content, 'utf8');
        applied.push({ action, description: action.description || `写入文件 ${action.target}` });
        continue;
      }
      const desc = applyToSettings(cloned, action);
      applied.push({ action, description: action.description || desc });
    } catch (e) {
      failed.push({ action, error: e.message || String(e) });
    }
  }

  if (applied.length) {
    try {
      save(cloned);
    } catch (e) {
      failed.push({ action: null, error: `保存设置失败：${e.message}` });
      return { ok: false, applied: [], failed, backupPath };
    }
  }

  return { ok: failed.length === 0, applied, failed, backupPath };
}

/** 从备份回滚设置 */
function rollback(backupPath, save) {
  if (!backupPath || !fs.existsSync(backupPath)) throw new Error('没有可用的备份');
  const data = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
  save(data);
  return true;
}

module.exports = { applyActions, applyToSettings, resolveSafePath, rollback, ALLOWED_TYPES, NUM_RANGES, BACKUP_SUFFIX };
