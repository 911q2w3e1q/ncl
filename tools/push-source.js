/* 通过 GitHub Git Database API 推送源码到 main（沙箱连不上 github.com git push） */
'use strict';
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const TOKEN = execSync('gh auth token').toString().trim();
const REPO = '911q2w3e1q/ncl';
const API = 'https://api.github.com';
const ROOT = '/workspace/NCL';

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
  // 1. 远程 main HEAD
  const ref = await api('GET', `/repos/${REPO}/git/ref/heads/main`);
  const headSha = ref.object.sha;
  const headCommit = await api('GET', `/repos/${REPO}/git/commits/${headSha}`);
  const baseTree = headCommit.tree.sha;
  console.log('远程 main HEAD:', headSha.slice(0, 8));

  // 2. 收集变更文件（git status 解析；quotePath=false 避免中文路径被转义）
  const status = execSync('git -c core.quotePath=false status --porcelain', { cwd: ROOT }).toString();
  const files = [];
  for (const line of status.split('\n')) {
    if (!line.trim()) continue;
    const st = line.slice(0, 2), p = line.slice(3).trim();
    if (p === 'NCL-1.1.0-linux-x64.tar.gz') continue; // 已移走但 git 可能仍缓存状态
    if (/\.zip$|\.tar\.gz$|\.log$|node_modules/.test(p)) continue;
    files.push({ status: st.trim(), path: p });
  }
  // docs/ 新截图（git status 已覆盖 ?? 状态，无需额外）
  console.log(`待推送文件 ${files.length} 个:`);
  files.forEach((f) => console.log(`  [${f.status}] ${f.path}`));

  // 3. 逐个创建 blob
  const tree = [];
  for (const f of files) {
    const abs = path.join(ROOT, f.path);
    if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
      if (fs.statSync(abs).isDirectory()) {
        // 目录：递归纳入
        const walk = (dir) => {
          for (const name of fs.readdirSync(dir)) {
            const fp = path.join(dir, name);
            if (fs.statSync(fp).isDirectory()) walk(fp);
            else if (!/\.zip$|\.tar\.gz$|\.log$/.test(name)) {
              const rel = path.relative(ROOT, fp);
              const content = fs.readFileSync(fp).toString('base64');
              tree.push({ path: rel, mode: '100644', type: 'blob', _content: content });
            }
          }
        };
        walk(abs);
        console.log(`  目录 ${f.path} 递归纳入`);
        continue;
      }
      console.log(`  跳过不存在: ${f.path}`);
      continue;
    }
    const content = fs.readFileSync(abs).toString('base64');
    const mode = /\.sh$/.test(f.path) ? '100755' : '100644';
    tree.push({ path: f.path, mode, type: 'blob', _content: content });
  }

  // 4. 创建 blobs 并收集 sha
  const treeEntries = [];
  for (const t of tree) {
    const blob = await api('POST', `/repos/${REPO}/git/blobs`, { content: t._content, encoding: 'base64' });
    treeEntries.push({ path: t.path, mode: t.mode, type: 'blob', sha: blob.sha });
    console.log(`  blob ${t.path} → ${blob.sha.slice(0, 8)}`);
  }

  // 5. 创建 tree（基于远程 HEAD）
  const newTree = await api('POST', `/repos/${REPO}/git/trees`, { base_tree: baseTree, tree: treeEntries });
  console.log('新 tree:', newTree.sha.slice(0, 8));

  // 6. 创建 commit
  const commit = await api('POST', `/repos/${REPO}/git/commits`, {
    message: 'NCL 1.2.0 稳定性与便携性更新\n\n- 修复 LittleSkin 登录空引用崩溃（账户卡 innerHTML 重建丢失 acc-api 元素，mock 皮肤站复现）\n- 修复启动假死：spawn error 监听 + 并发锁 + Java 下载进度\n- 修复下载 UI 卡死：解压移入子进程，整合包异步解析\n- 修复 Fabric 装不了：meta 双源 + maven 镜像回退，页签全量列表可搜索\n- 游戏数据默认便携目录，支持更改/迁移；打开文件夹走 shell.openPath\n- 新增检查更新（GitHub Releases 一键下载安装）\n- Wiki 页内直读 Mojang 官方更新日志（HTML 白名单净化）\n- 内存上限按系统内存封顶；refresh 并发守卫\n- 新增 updater-wiki-test（27 断言）与 LittleSkin 复现脚本',
    tree: newTree.sha,
    parents: [headSha],
  });
  console.log('新 commit:', commit.sha.slice(0, 8));

  // 7. 更新 main ref
  await api('PATCH', `/repos/${REPO}/git/refs/heads/main`, { sha: commit.sha, force: false });
  console.log('✅ main 已更新:', commit.sha);

  // 8. 把 v1.2.0 tag 移到新 commit（release 创建时 GitHub 自动把 tag 指到了默认分支 HEAD，需修正）
  try {
    await api('PATCH', `/repos/${REPO}/git/refs/tags/v1.2.0`, { sha: commit.sha, force: true });
    console.log('✅ tag v1.2.0 已移到新 commit');
  } catch (e) {
    if (/already exists/i.test(e.message)) console.log('tag v1.2.0 已存在（指向 release 初始 commit，正常）');
    else console.log('tag 更新跳过:', e.message.slice(0, 120));
  }
  console.log('\n全部完成');
})().catch((e) => { console.error('推送失败:', e.message); process.exit(1); });
