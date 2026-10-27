#!/usr/bin/env node
/* 完整同步工作区到远程分支（GitHub Git Data API）
 *
 * 为什么需要它：
 *  - 沙箱内 git push 直连 github.com 超时，只能走 gh CLI 的 API 通道
 *  - push-via-api.js 基于 git diff <远程基线> HEAD 计算增量，
 *    但远程分支的提交不在本地对象库里（只有 tree 被推上去），
 *    增量 diff 会漏掉「远程没有、本地有」的文件（如 renderer/ 整个目录）
 *
 * 本脚本的做法：不依赖本地 git 对象库，直接遍历工作区需要上传的文件，
 * 用 API 建 blob → 建完整 tree → 建 commit → 更新 ref。
 *
 * 用法：node tools/sync-full.js <分支名> [tag名]
 */
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const REPO = '911q2w3e1q/ncl';
const BRANCH = process.argv[2] || 'main';
const TAG = process.argv[3] || '';

/** 需要上传的目录与文件（相对 ROOT） */
const INCLUDE_DIRS = ['main', 'renderer', 'assets', 'core', 'tools', 'test', 'build', 'dotnet/NCL.NET/Core', 'dotnet/NCL.NET/Forms', 'dotnet/NCL.NET/Resources', 'docs'];
const INCLUDE_FILES = ['package.json', 'package-lock.json', 'README.md', 'HANDOFF.md', 'LICENSE', '.gitignore'];

/** 忽略规则 */
const IGNORE = [
  (p) => p.includes('node_modules'),
  (p) => p.includes('/obj/') || p.includes('/bin/'),
  (p) => p.endsWith('.log'),
  (p) => p.endsWith('ai/ai-runtime.js'),
  (p) => p.endsWith('/.DS_Store'),
  (p) => p.includes('release/') || p.includes('release-linux-test/'),
  (p) => p.includes('electron-dists'),
];

function gh(args, input) {
  const out = execFileSync('gh', args, {
    input: input || '',
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
  });
  return out.trim() ? JSON.parse(out) : null;
}

function walk(dir, base, out) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    const rel = base ? `${base}/${e.name}` : e.name;
    if (IGNORE.some((fn) => fn(rel))) continue;
    if (e.isDirectory()) walk(abs, rel, out);
    else if (e.isFile()) out.push(rel);
  }
}

function collect() {
  const files = [];
  for (const d of INCLUDE_DIRS) walk(path.join(ROOT, d), d, files);
  for (const f of INCLUDE_FILES) {
    if (fs.existsSync(path.join(ROOT, f))) files.push(f);
  }
  return files.sort();
}

function mkBlob(absPath) {
  const content = fs.readFileSync(absPath);
  const b64 = content.toString('base64');
  return gh(['api', `repos/${REPO}/git/blobs`, '--input', '-'],
    JSON.stringify({ content: b64, encoding: 'base64' }));
}

function main() {
  const files = collect();
  console.log(`待上传 ${files.length} 个文件`);

  // 1) 逐个建 blob
  const entries = [];
  for (const rel of files) {
    const abs = path.join(ROOT, rel);
    const content = fs.readFileSync(abs);
    const blob = mkBlob(abs);
    const isExec = (content[0] === 0x23 && content[1] === 0x21) || rel.endsWith('.sh');
    entries.push({ path: rel, mode: isExec ? '100755' : '100644', type: 'blob', sha: blob.sha });
  }

  // 2) 建完整 tree（不带 base_tree = 全量替换）
  const tree = gh(['api', `repos/${REPO}/git/trees`, '--input', '-'],
    JSON.stringify({ tree: entries }));
  console.log(`新 tree ${tree.sha.slice(0, 8)}`);

  // 3) 建 commit（父提交 = 远程当前 head）
  const cur = gh(['api', `repos/${REPO}/git/ref/heads/${BRANCH}`]);
  const parent = cur.object.sha;
  const message = TAG
    ? `NCL ${TAG}：${process.env.NCL_MSG || ''}`.trim()
    : (process.env.NCL_MSG || 'NCL 同步');
  const commit = gh(['api', `repos/${REPO}/git/commits`, '--input', '-'], JSON.stringify({
    message,
    tree: tree.sha,
    parents: [parent],
  }));
  console.log(`新 commit ${commit.sha.slice(0, 8)}（父 ${parent.slice(0, 8)}）`);

  // 4) 更新分支 ref
  gh(['api', `repos/${REPO}/git/refs/heads/${BRANCH}`, '--method', 'PATCH', '--input', '-'],
    JSON.stringify({ sha: commit.sha, force: true }));
  console.log(`分支 ${BRANCH} 已更新`);

  // 5) 打 tag
  if (TAG) {
    const tagObj = gh(['api', `repos/${REPO}/git/tags`, '--input', '-'], JSON.stringify({
      tag: TAG,
      message: `NCL ${TAG}`,
      object: commit.sha,
      type: 'commit',
      tagger: { name: 'NCL', email: 'ncl@local', date: new Date().toISOString() },
    }));
    try {
      gh(['api', `repos/${REPO}/git/refs`, '--input', '-'],
        JSON.stringify({ ref: `refs/tags/${TAG}`, sha: tagObj.sha }));
      console.log(`tag ${TAG} 已创建（对象 ${tagObj.sha.slice(0, 8)}）`);
    } catch (e) {
      console.log(`tag ${TAG} 创建失败：${e.message}`);
    }
  }

  console.log(`\n完成。commit=${commit.sha}`);
}

main();
