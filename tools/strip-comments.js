#!/usr/bin/env node
/* 清理源码里的大段注释。
 *
 * 规则：
 *   - 删除所有 /* ... *\/ 形式的块注释
 *   - 删除整行注释（// 开头）
 *   - 保留行尾注释（代码后面的 // xxx）
 *   - 不动字符串、模板串、正则字面量里的 // 和 /*
 *
 * 用法：node tools/strip-comments.js <文件...>
 */
'use strict';

const fs = require('fs');

/** 是否保留行尾注释（默认全删） */
const KEEP_TRAILING = process.argv.includes('--keep-trailing');

/** 判断此处的 / 是否为正则字面量开头 */
function isRegexStart(src, i) {
  // 回溯找上一个非空白字符
  let j = i - 1;
  while (j >= 0 && /\s/.test(src[j])) j--;
  if (j < 0) return true;
  const c = src[j];
  // 前面是标识符/数字/字面量结尾 → 是除号
  if (/[A-Za-z0-9_$)\]}'"`]/.test(c)) {
    // 但 return / 赋值 = / typeof 之类后面可能是正则
    const before = src.slice(Math.max(0, j - 12), j + 1);
    if (/\b(return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else)$/.test(before)) return true;
    return false;
  }
  return true;
}

/** 逐字符扫描，跳过字符串/模板串/正则/注释 */
function stripBlockComments(text) {
  let out = '';
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    const c2 = text[i + 1];
    // 字符串 / 模板串
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      out += c; i++;
      while (i < n) {
        if (text[i] === '\\') { out += text[i] + (text[i + 1] || ''); i += 2; continue; }
        out += text[i];
        if (text[i] === quote) { i++; break; }
        i++;
      }
      continue;
    }
    // 正则字面量
    if (c === '/' && c2 !== '/' && c2 !== '*' && isRegexStart(text, i)) {
      let j = i + 1;
      let inClass = false;
      let ok = false;
      while (j < n) {
        const ch = text[j];
        if (ch === '\\') { j += 2; continue; }
        if (ch === '[') inClass = true;
        else if (ch === ']') inClass = false;
        else if (ch === '\n') break;
        else if (ch === '/' && !inClass) { ok = true; break; }
        j++;
      }
      if (ok) {
        out += text.slice(i, j + 1);
        i = j + 1;
        while (i < n && /[gimsuy]/.test(text[i])) { out += text[i]; i++; }
        continue;
      }
    }
    // 块注释
    if (c === '/' && c2 === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
      out += '\n';
      continue;
    }
    // 行注释
    if (c === '/' && c2 === '/') {
      const end = text.indexOf('\n', i);
      const line = text.slice(i, end === -1 ? n : end);
      i = end === -1 ? n : end;
      const before = out.replace(/[ \t]+$/, '');
      const isTrailing = before.length > 0 && !before.endsWith('\n');
      if (isTrailing && KEEP_TRAILING) {
        const body = line.replace(/^\/\/\s*/, '').trim();
        if (body) out += ' // ' + body;
      } else if (isTrailing) {
        // 删掉行尾注释，连同前面的多余空格
        out = before;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function stripCssComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/[ \t]+$/gm, '');
}

function stripHtmlComments(text) {
  return text.replace(/<!--[\s\S]*?-->/g, '').replace(/^[ \t]*\n/gm, '');
}

function squeezeBlank(text) {
  return text.replace(/\n{3,}/g, '\n\n');
}

function processFile(f) {
  const orig = fs.readFileSync(f, 'utf8');
  let out;
  if (f.endsWith('.css')) out = stripCssComments(orig);
  else if (f.endsWith('.html')) out = stripHtmlComments(orig);
  else out = stripBlockComments(orig);
  out = squeezeBlank(out).replace(/\n+$/, '\n');
  if (out !== orig) {
    fs.writeFileSync(f, out);
    console.log(`  ${f}: ${orig.split('\n').length} → ${out.split('\n').length} 行`);
  }
}

for (const f of process.argv.slice(2)) {
  if (f.startsWith('--')) continue;
  if (!fs.existsSync(f)) { console.log(`  跳过（不存在）：${f}`); continue; }
  processFile(f);
}
console.log('完成');
