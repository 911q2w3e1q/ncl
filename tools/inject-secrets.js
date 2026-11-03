#!/usr/bin/env node
/* CurseForge API Key 编译期注入器
 *
 * 用法（构建前设置环境变量）：
 *   NCL_CURSEFORGE_API_KEY='$2a$10$xxx...' node tools/build-electron.js --platform=win32 --arch=x64
 *
 * 为什么不直接写进源码：
 *   1. 源码在 GitHub 上公开，写死等于把 Key 直接暴露给所有人；
 *   2. GitHub 的 secret scanning 会拦截含密钥的提交（GH013），发布流程直接失败；
 *   3. Key 属于「你这把」而非「项目公用」，应当能随时轮换而不必改代码。
 *
 * 产物里会生成 main/secrets.js（仅在检测到 Key 时生成），源码仓库中不存在该文件。
 * 运行期 main/secrets.js 若不存在，main/curseforge.js 会安全降级为「无内置 Key」。
 *
 * 与 PCL / Prism Launcher 的做法一致（它们用 Source Generator 在编译期注入，
 * 源码同样不写死 Key，Key 只存在于构建机和最终二进制里）。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'main', 'secrets.js');

/** 读取构建期 Key。优先 NCL_CURSEFORGE_API_KEY，其次 CURSEFORGE_API_KEY。 */
function readKey() {
  const raw = process.env.NCL_CURSEFORGE_API_KEY || process.env.CURSEFORGE_API_KEY || '';
  const key = String(raw).trim();
  if (!key) return '';
  // CF 的 Key 形如 $2a$10$...，含 $ 与 / 等字符，这里只做基本合理性检查
  if (!/^\$?2[aby]\$\d{2}\$/.test(key)) {
    console.warn('  [secrets] NCL_CURSEFORGE_API_KEY 格式不像 CurseForge Key（应形如 $2a$10$...），已忽略');
    return '';
  }
  return key;
}

/**
 * 生成 main/secrets.js。
 * @param {string} key CF API Key，空串表示不注入
 * @returns {{ injected: boolean, path: string }}
 */
function injectSecrets(key) {
  // 无 Key：确保不存在旧文件，避免上一轮构建残留的 Key 混进本次产物
  if (!key) {
    try { if (fs.existsSync(OUT)) fs.unlinkSync(OUT); } catch { /* 忽略 */ }
    return { injected: false, path: OUT };
  }
  const body = `/* 自动生成，请勿手动修改，也不要提交到版本库。
 * 由 tools/build-electron.js 在构建时依据环境变量 NCL_CURSEFORGE_API_KEY 生成。
 * 生成时间：${new Date().toISOString()}
 */
'use strict';

// CurseForge API Key：编译期内置，作为用户自填 Key 之外的兜底。
// 官方接口与 CDN 下载在需要时会带上它。
const CURSEFORGE_API_KEY = ${JSON.stringify(key)};

module.exports = { CURSEFORGE_API_KEY };
`;
  fs.writeFileSync(OUT, body, 'utf8');
  return { injected: true, path: OUT };
}

module.exports = { injectSecrets, readKey };

// 直接执行时：只做一次注入，方便单独跑
if (require.main === module) {
  const k = readKey();
  const r = injectSecrets(k);
  console.log(r.injected
    ? `  [secrets] 已注入 CurseForge Key → ${path.relative(ROOT, r.path)}`
    : '  [secrets] 未设置 NCL_CURSEFORGE_API_KEY，本次构建不含内置 Key');
}
