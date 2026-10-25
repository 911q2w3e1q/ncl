/* 通过 GitHub Git Database API 推送源码到 main（沙箱连不上 github.com git push）
 * 用法：node tools/push-source.js <tag> "<commit message>"
 * 文件集 = 远程 HEAD 树 与 本地 HEAD 树 的差异（git diff --name-status <remoteSha> HEAD）
 */
'use strict';
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const TOKEN = execSync('gh auth token').toString().trim();
const REPO = '911q2w3e1q/ncl';
const API = 'https://api.github.com';
const ROOT = '/workspace/NCL';

const TAG = process.argv[2] || 'v1.3.0';
const MSG = process.argv[3] || 'NCL 1.3.0';

const headers = {
  Authorization: `token ${TOKEN}`,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'NCL-Launcher',
  'Content-Type': 'application/json',
};

async function api(method, urlPath, body) {
  const res = await fetch(API + urlPath, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 非 JSON */ }
  if (!res.ok) throw new Error(`${method} ${urlPath} → HTTP ${res.status}: ${text.slice(0, 300)}`);
  return json;
}

(async () => {
  const ref = await api('GET', `/repos/${REPO}/git/ref/heads/main`);
  const headSha = ref.object.sha;
  const headCommit = await api('GET', `/repos/${REPO}/git/commits/${headSha}`);
  const baseTree = headCommit.tree.sha;
  console.log('远程 main HEAD:', headSha.slice(0, 8));

  // 差异文件：本地 HEAD tree vs 远程 HEAD tree（远程 commit 对象本地不存在，用 tree API 比对）
  const remoteTree = await api('GET', `/repos/${REPO}/git/trees/${baseTree}?recursive=1`);
  const remoteMap = new Map(remoteTree.tree.map((t) => [t.path, t.sha]));
  const localRaw = execSync('git -c core.quotePath=false ls-tree -r HEAD', { cwd: ROOT }).toString();
  const files = [];
  for (const line of localRaw.split('\n')) {
    if (!line.trim()) continue;
    const m = line.match(/^(\d+)\s+blob\s+([0-9a-f]+)\s+(.*)$/);
    if (!m) continue;
    const [, mode, sha, p] = m;
    if (/\.zip$|\.tar\.gz$|\.log$|node_modules/.test(p)) continue;
    if (remoteMap.get(p) === sha) continue; // 未变化
    files.push({ status: remoteMap.has(p) ? 'M' : 'A', path: p, mode });
  }
  console.log(`待推送文件 ${files.length} 个:`);
  files.forEach((f) => console.log(`  [${f.status}] ${f.path}`));

  const tree = [];
  for (const f of files) {
    const abs = path.join(ROOT, f.path);
    if (!fs.existsSync(abs)) { console.log('  跳过不存在:', f.path); continue; }
    if (fs.statSync(abs).isDirectory()) {
      const walk = (dir) => {
        for (const name of fs.readdirSync(dir)) {
          const fp = path.join(dir, name);
          if (fs.statSync(fp).isDirectory()) walk(fp);
          else if (!/\.zip$|\.tar\.gz$|\.log$/.test(name)) {
            const rel = path.relative(ROOT, fp);
            tree.push({ path: rel, mode: '100644', type: 'blob', _content: fs.readFileSync(fp).toString('base64') });
          }
        }
      };
      walk(abs);
      console.log('  目录递归纳入:', f.path);
      continue;
    }
    const mode = /\.sh$/.test(f.path) ? '100755' : '100644';
    tree.push({ path: f.path, mode, type: 'blob', _content: fs.readFileSync(abs).toString('base64') });
  }

  const treeEntries = [];
  for (const t of tree) {
    const blob = await api('POST', `/repos/${REPO}/git/blobs`, { content: t._content, encoding: 'base64' });
    treeEntries.push({ path: t.path, mode: t.mode, type: 'blob', sha: blob.sha });
    console.log(`  blob ${t.path} → ${blob.sha.slice(0, 8)}`);
  }

  const newTree = await api('POST', `/repos/${REPO}/git/trees`, { base_tree: baseTree, tree: treeEntries });
  console.log('新 tree:', newTree.sha.slice(0, 8));

  const commit = await api('POST', `/repos/${REPO}/git/commits`, {
    message: MSG,
    tree: newTree.sha,
    parents: [headSha],
  });
  console.log('新 commit:', commit.sha.slice(0, 8));

  await api('PATCH', `/repos/${REPO}/git/refs/heads/main`, { sha: commit.sha, force: false });
  console.log('✅ main 已更新:', commit.sha);

  // tag 移到新 commit（release 创建时 GitHub 会自动把 tag 指到默认分支 HEAD）
  try {
    await api('PATCH', `/repos/${REPO}/git/refs/tags/${TAG}`, { sha: commit.sha, force: true });
    console.log(`✅ tag ${TAG} 已移到新 commit`);
  } catch (e) {
    console.log('tag 更新跳过:', e.message.slice(0, 160));
  }
  console.log('\n全部完成');
})().catch((e) => { console.error('推送失败:', e.message); process.exit(1); });
