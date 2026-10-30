/* 上下文裁剪行为测试
 *
 * 直接从 ai/ai-worker.js 抽取 fitMessages 逻辑并用模拟 tokenizer 驱动，
 * 验证「长日志不再触发 position_ids 越界」这一核心修复。
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log(`PASS  ${name}`); }
  catch (e) { failed++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}

const src = fs.readFileSync(path.join(ROOT, 'ai', 'ai-worker.js'), 'utf8');
const body = src.slice(src.indexOf('function estimateTokens'), src.indexOf('async function generate('));
const { fitMessages, countTokens } = new Function(body + '\nreturn { fitMessages, countTokens, cutTokens };')();

function fakeTokenizer() {
  return {
    encode(text) {
      const ids = [];
      let i = 0;
      while (i < String(text).length) {
        const cjk = /[\u3400-\u9fff]/.test(String(text)[i]);
        ids.push(0);
        i += cjk ? 1.5 : 4;
      }
      return ids;
    },
    decode(ids) { return 'X'.repeat(ids.length * 4); },
  };
}

const tok = fakeTokenizer();
const measure = (list) => list.reduce((s, m) => s + tok.encode(m.content).length + 8, 0);

t('120000 字符日志被裁剪到预算内（不再 position_ids 越界）', () => {
  const win = 8192, gen = 512;
  const limit = win - gen - 64;
  const msgs = [
    { role: 'system', content: '你是Minecraft故障排查助手，用中文简短回答。' },
    { role: 'user', content: 'X'.repeat(120000) },
  ];
  return fitMessages(tok, msgs, win, gen).then((fitted) => {
    const total = measure(fitted);
    assert.ok(total <= limit, `裁剪后 ${total} 超出预算 ${limit}`);
    assert.ok(total + gen <= win, `加上生成 ${gen} 后共 ${total + gen} 越过了位置嵌入上限 ${win}`);
  });
});

t('Qwen 的 32768 窗口被正确使用', () => {
  const win = 32768, gen = 512;
  const limit = win - gen - 64;
  const msgs = [{ role: 'user', content: 'Y'.repeat(200000) }];
  return fitMessages(tok, msgs, win, gen).then((fitted) => {
    const total = measure(fitted);
    assert.ok(total <= limit, `裁剪后 ${total} 超出预算 ${limit}`);
    assert.ok(total + gen <= win);
  });
});

t('短输入不被误裁剪', () => {
  const msgs = [{ role: 'user', content: '游戏崩溃了，怎么办？' }];
  return fitMessages(tok, msgs, 8192, 512).then((fitted) => {
    assert.strictEqual(fitted[0].content, '游戏崩溃了，怎么办？');
  });
});

t('裁剪后保留截断提示标记', () => {
  const msgs = [{ role: 'user', content: 'X'.repeat(120000) }];
  return fitMessages(tok, msgs, 8192, 512).then((fitted) => {
    assert.ok(fitted[0].content.includes('截断'), '缺少截断提示');
  });
});

t('多条消息时优先保留靠后的（最近的）上下文', () => {
  const msgs = [
    { role: 'system', content: '系统提示'.repeat(500) },
    { role: 'user', content: '用户问题'.repeat(500) },
    { role: 'assistant', content: '助手回答'.repeat(500) },
  ];
  return fitMessages(tok, msgs, 8192, 512).then((fitted) => {
    const total = measure(fitted);
    assert.ok(total <= 8192 - 512 - 64, `总长 ${total} 超预算`);
  });
});

function realTokenizerTest() {
  const MODEL_ROOT = process.env.AI_MODEL_ROOT || '/tmp/ncl-ai-test';
  const REPO = 'HuggingFaceTB/SmolLM2-135M-Instruct';
  const p = path.join(MODEL_ROOT, 'ai-models', REPO);
  if (!fs.existsSync(path.join(p, 'tokenizer.json'))) {
    console.log('SKIP  真实 tokenizer 回归（本地无模型权重）');
    return;
  }
  const { AutoTokenizer, env } = require('@huggingface/transformers');
  env.allowLocalModels = true;
  env.allowRemoteModels = false;
  env.localModelPath = path.join(MODEL_ROOT, 'ai-models') + path.sep;
  AutoTokenizer.from_pretrained(REPO).then((realTok) => {
    const msgs = [
      { role: 'system', content: '你是Minecraft故障排查助手，用中文简短回答。' },
      { role: 'user', content: '游戏崩溃了，OutOfMemoryError。\n' + 'X'.repeat(120000) },
    ];
    const orig = countTokens(realTok, msgs[1].content);
    fitMessages(realTok, msgs, 8192, 8).then((fitted) => {
      const after = countTokens(realTok, fitted[1].content);
      const limit = 8192 - 8 - 64;
      try {
        assert.ok(orig > limit, `原始 ${orig} 应超出预算 ${limit}`);
        assert.ok(after <= limit, `裁剪后 ${after} 仍超出预算 ${limit}`);
        assert.ok(after + 8 <= 8192, `加上生成后 ${after + 8} 越过位置嵌入上限 8192`);
        passed++;
        console.log(`PASS  真实 SmolLM2 tokenizer：原始 ${orig} token → 裁剪后 ${after} token（预算 ${limit}，加生成后 ${after + 8} ≤ 8192）`);
      } catch (e) {
        failed++;
        console.log(`FAIL  真实 SmolLM2 tokenizer：${e.message}`);
      }
      done();
    });
  }).catch((e) => {
    console.log(`SKIP  真实 tokenizer 回归（加载失败：${String(e.message).slice(0, 80)}）`);
    done();
  });
}

function done() {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

realTokenizerTest();
