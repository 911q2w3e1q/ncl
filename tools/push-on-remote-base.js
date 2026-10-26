#!/usr/bin/env node
/* 以远端当前 commit 为基线，把本地新增提交推到 GitHub（Git Data API）
 *
 * 用法：node tools/push-on-remote-base.js <分支> <文件...>
 * 场景：本地 origin/main 引用过期、git fetch 直连又很慢时，直接以远端
 * ref 指向的 commit 为 parent 建新 commit，避免历史重写。
 */
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const REPO = '911q2w3e1q/ncl';
const BRANCH = process.argv[2] || 'main';
const FILES = process.argv.slice(3);

function gh(args, input) {
  const out = execFileSync('gh', args, {
    input: input || '',
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return out.trim() ? JSON.parse(out) : null;
}

/** 远端 ref 指向的 commit（若是 annotated tag 则解包到 commit） */
function remoteHead() {
  const ref = gh(['api', `repos/${REPO}/git/ref/heads/${BRANCH}`]);
  let sha = ref.object.sha;
  if (ref.object.type === 'tag') {
    sha = gh(['api', `repos/${REPO}/git/tags/${sha}`]).object.sha;
  }
  return sha;
}

function mkBlob(file) {
  const content = fs.readFileSync(path.join(ROOT, file));
  const b64 = content.toString('base64');
  return gh(['api', `repos/${REPO}/git/blobs`, '--input', '-'],
    JSON.stringify({ content: b64, encoding: 'base64' })).sha;
}

function main() {
  const base = remoteHead();
  console.log(`远端基线 ${base.slice(0, 8)}`);

  const baseCommit = gh(['api', `repos/${REPO}/git/commits/${base}`]);
  const entries = FILES.map((f) => {
    const content = fs.readFileSync(path.join(ROOT, f));
    const isExec = (content[0] === 0x23 && content[1] === 0x21) || f.endsWith('.sh');
    return { path: f, mode: isExec ? '100755' : '100644', type: 'blob', sha: mkBlob(f) };
  });

  const tree = gh(['api', `repos/${REPO}/git/trees`, '--input', '-'],
    JSON.stringify({ base_tree: baseCommit.tree.sha, tree: entries }));
  console.log(`新 tree ${tree.sha.slice(0, 8)}`);

  const message = execFileSync('git', ['log', '-1', '--pretty=%B'], { cwd: ROOT, encoding: 'utf8' }).trim();
  const commit = gh(['api', `repos/${REPO}/git/commits`, '--input', '-'],
    JSON.stringify({ message, tree: tree.sha, parents: [base] }));
  console.log(`新 commit ${commit.sha.slice(0, 8)}`);

  gh(['api', `repos/${REPO}/git/refs/heads/${BRANCH}`, '--method', 'PATCH', '--input', '-'],
    JSON.stringify({ sha: commit.sha, force: false }));
  console.log(`分支 ${BRANCH} 已更新 → ${commit.sha}`);
}

main();
