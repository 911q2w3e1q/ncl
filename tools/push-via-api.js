#!/usr/bin/env node
/* 通过 GitHub Git Data API 推送提交与 tag
 *
 * 用法：node tools/push-via-api.js <分支名> <tag名>
 */
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const REPO = '911q2w3e1q/ncl';
const BRANCH = process.argv[2] || 'main';
const TAG = process.argv[3] || '';

function gh(args, input) {
  const out = execFileSync('gh', args, {
    input: input || '',
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return out.trim() ? JSON.parse(out) : null;
}

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
}

function collectChanges() {
  const base = git(['rev-parse', `origin/${BRANCH}`]);
  const head = git(['rev-parse', 'HEAD']);
  const names = git(['diff', '--name-status', base, head]).split('\n').filter(Boolean);
  const changes = [];
  for (const line of names) {
    const [status, ...rest] = line.split('\t');
    const file = rest[rest.length - 1];
    changes.push({ status, path: file });
  }
  return { base, head, changes };
}

function mkBlob(content) {
  const b64 = Buffer.from(content, 'utf8').toString('base64');
  return gh(['api', `repos/${REPO}/git/blobs`, '--input', '-'], JSON.stringify({ content: b64, encoding: 'base64' }));
}

function mkTree(baseTree, changes) {
  const entries = [];
  for (const c of changes) {
    const abs = path.join(ROOT, c.path);
    if (c.status === 'D') {
      entries.push({ path: c.path, mode: '100644', type: 'blob', sha: null });
      continue;
    }
    if (!fs.existsSync(abs)) continue;
    const content = fs.readFileSync(abs);
    const b64 = content.toString('base64');
    const blob = gh(['api', `repos/${REPO}/git/blobs`, '--input', '-'], JSON.stringify({ content: b64, encoding: 'base64' }));
    const isExec = (content[0] === 0x23 && content[1] === 0x21) || c.path.endsWith('.sh') || c.path.endsWith('.exe');
    entries.push({ path: c.path, mode: isExec ? '100755' : '100644', type: 'blob', sha: blob.sha });
  }
  return gh(['api', `repos/${REPO}/git/trees`, '--input', '-'], JSON.stringify({ base_tree: baseTree, tree: entries }));
}

function main() {
  const { base, changes } = collectChanges();
  console.log(`基线 ${base.slice(0, 8)}，变更 ${changes.length} 个文件`);

  const baseCommit = gh(['api', `repos/${REPO}/git/commits/${base}`]);
  const tree = mkTree(baseCommit.tree.sha, changes);
  console.log(`新 tree ${tree.sha.slice(0, 8)}`);

  const message = git(['log', '-1', '--pretty=%B']).trim();
  const commit = gh(['api', `repos/${REPO}/git/commits`, '--input', '-'], JSON.stringify({
    message,
    tree: tree.sha,
    parents: [base],
  }));
  console.log(`新 commit ${commit.sha.slice(0, 8)}`);

  
  const cur = gh(['api', `repos/${REPO}/git/ref/heads/${BRANCH}`]);
  gh(['api', `repos/${REPO}/git/refs/heads/${BRANCH}`, '--method', 'PATCH', '--input', '-'],
    JSON.stringify({ sha: commit.sha, force: true }));
  console.log(`分支 ${BRANCH} 已更新`);

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
      console.log(`tag ${TAG} 已创建`);
    } catch (e) {
      console.log(`tag ${TAG} 创建失败：${e.message}`);
    }
  }

  console.log(`\n完成。commit=${commit.sha}`);
}

main();
