'use strict';
const { BrowserWindow, shell } = require('electron');
const crypto = require('crypto');
const path = require('path');

const MS_CLIENT_ID = '00000000441cc96b';
const MS_SCOPE = 'service::user.auth.xboxlive.com::MBI_SSL';
const MS_AUTHORIZE_URL = 'https://login.live.com/oauth20_authorize.srf';
const MS_REDIRECT_URI = 'https://login.live.com/oauth20_desktop.srf';
const MS_LOGIN_HOSTS = ['login.live.com', 'login.microsoftonline.com', 'account.live.com', 'login.windows.net'];

function isMicrosoftLoginUrl(url) {
  try {
    const u = new URL(url);
    if (!MS_LOGIN_HOSTS.includes(u.hostname)) return false;
    return u.pathname.startsWith('/oauth20_authorize.srf') || u.pathname.startsWith('/common/oauth2/authorize');
  } catch { return false; }
}

function parseFragmentToken(url) {
  try {
    const u = new URL(url);
    const h = u.hash.startsWith('#') ? u.hash.slice(1) : u.hash;
    const out = {};
    for (const part of h.split('&')) {
      if (!part) continue;
      const i = part.indexOf('=');
      if (i < 0) continue;
      out[decodeURIComponent(part.slice(0, i))] = decodeURIComponent(part.slice(i + 1));
    }
    if (!out.access_token && u.searchParams.get('access_token')) {
      for (const [k, v] of u.searchParams.entries()) out[k] = v;
    }
    if (out.access_token) return out;
  } catch {}
  return null;
}

function parseAuthError(url) {
  try {
    const u = new URL(url);
    const h = u.hash.startsWith('#') ? u.hash.slice(1) : u.hash;
    const src = h || u.search;
    const p = new URLSearchParams(src);
    if (p.get('error')) return p.get('error_description') || p.get('error');
  } catch {}
  return null;
}

function buildAuthorizeUrl(account, state) {
  const q = new URLSearchParams({
    client_id: MS_CLIENT_ID,
    scope: MS_SCOPE,
    response_type: 'token',
    redirect_uri: MS_REDIRECT_URI,
    state,
  });
  const hint = String(account || '').trim();
  if (hint) q.set('login_hint', hint);
  return `${MS_AUTHORIZE_URL}?${q.toString()}`;
}

const FILL_SCRIPT = (email, password, submitEmail, submitPassword) => `(() => {
  const setVal = (el, v) => {
    if (!el) return false;
    const proto = Object.getPrototypeOf(el);
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, v); else el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  };
  const emailEl = document.querySelector('#usernameEntry') || document.querySelector('input[type=email]') || document.querySelector('#i0116');
  const passEl = document.querySelector('input[type=password]') || document.querySelector('#passwordEntry') || document.querySelector('#i0117');
  const btn = document.querySelector('button[data-testid=primaryButton]') || document.querySelector('#idSIButton9') || document.querySelector('button[type=submit]');
  const out = { email: false, password: false, submitted: null, needPassword: false };
  if (passEl) {
    out.needPassword = true;
    if (${JSON.stringify(password || '')}) {
      out.password = setVal(passEl, ${JSON.stringify(password || '')});
      if (out.password && ${submitPassword ? 'true' : 'false'} && btn) { btn.click(); out.submitted = 'password'; }
    }
  } else if (emailEl) {
    if (${JSON.stringify(email || '')}) {
      out.email = setVal(emailEl, ${JSON.stringify(email || '')});
      if (out.email && ${submitEmail ? 'true' : 'false'} && btn) { btn.click(); out.submitted = 'email'; }
    }
  }
  return JSON.stringify(out);
})()`;

const PROBE_SCRIPT = `(() => {
  const emailEl = document.querySelector('#usernameEntry') || document.querySelector('input[type=email]') || document.querySelector('#i0116');
  const passEl = document.querySelector('input[type=password]') || document.querySelector('#passwordEntry') || document.querySelector('#i0117');
  return JSON.stringify({ hasEmail: !!emailEl, hasPassword: !!passEl });
})()`;

function detectPageState() {
  const body = (document.body && document.body.innerText || '').toLowerCase();
  const has = (k) => body.includes(k);
  if (has('one-time code') || has('两步') || has('two-step') || has('identity verification') || has('verify your identity') || has('辅助邮箱') || has('alternate email') || has('approvals')) return 'MFA';
  if (has('incorrect password') || has('that password is incorrect') || has('密码不正确') || has('wrong password') || has('your password is incorrect') || has('account has been locked') || has('账户已被锁定') || has('account is locked')) return 'BAD_PASSWORD';
  if (has("couldn't find a microsoft account") || has("we can't find an account") || has("that account doesn't exist") || has('找不到') || has('no account found') || has('we couldn’t find a microsoft account')) return 'NO_ACCOUNT';
  return 'OK';
}

let activeSession = null;

function closeSession() {
  if (!activeSession) return;
  const s = activeSession;
  activeSession = null;
  clearInterval(s.timer);
  try { if (s.win && !s.win.isDestroyed()) s.win.destroy(); } catch {}
}

function classifyError(text) {
  const t = String(text || '');
  if (/MFA|two-step|identity verification|one-time code/i.test(t)) return '该微软账号启用了两步验证，请改用「设备码授权」登录';
  if (/NO_ACCOUNT|no account|find an account|doesn't exist|couldn't find/i.test(t)) return '该邮箱不是有效的微软账号，请确认邮箱是否正确';
  if (/BAD_PASSWORD|incorrect password|wrong password|密码/i.test(t)) return '密码错误，请重新输入';
  if (/access_denied|declined|拒绝/i.test(t)) return '你取消了授权，未完成登录';
  if (/closed|cancel|取消|窗口/i.test(t)) return '登录窗口已关闭';
  return t;
}

async function openEmbeddedLogin({ email, password, parent, onStatus }) {
  closeSession();
  const state = crypto.randomUUID();
  const session = { state, win: null, done: false, timer: null };
  activeSession = session;

  const win = new BrowserWindow({
    width: 460,
    height: 620,
    parent: parent || undefined,
    modal: false,
    show: true,
    title: '微软账号登录',
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: 'ncl-ms-login',
    },
  });
  session.win = win;

  const finish = (err, token) => {
    if (session.done) return;
    session.done = true;
    clearInterval(session.timer);
    if (activeSession === session) activeSession = null;
    try { if (!win.isDestroyed()) win.destroy(); } catch {}
    if (err) onStatus && onStatus({ phase: 'error', error: classifyError(err.message || String(err)) });
    else onStatus && onStatus({ phase: 'token', token });
  };

  win.webContents.on('will-navigate', (e, url) => {
    const t = parseFragmentToken(url);
    if (t && t.access_token) {
      e.preventDefault();
      finish(null, t);
      return;
    }
    const err = parseAuthError(url);
    if (err) {
      e.preventDefault();
      finish(new Error(err));
    }
  });

  win.webContents.on('did-navigate', (_e, url) => {
    const t = parseFragmentToken(url);
    if (t && t.access_token) { finish(null, t); return; }
    const err = parseAuthError(url);
    if (err) finish(new Error(err));
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-redirect', (e, url) => {
    const t = parseFragmentToken(url);
    if (t && t.access_token) { e.preventDefault(); finish(null, t); }
  });

  win.on('closed', () => {
    if (!session.done) {
      session.done = true;
      clearInterval(session.timer);
      if (activeSession === session) activeSession = null;
      onStatus && onStatus({ phase: 'error', error: '登录窗口已关闭' });
    }
  });

  const url = buildAuthorizeUrl(email, state);
  await win.loadURL(url);

  let ticks = 0;
  let passDone = false;
  const fill = async () => {
    if (session.done) return;
    ticks += 1;
    try {
      const state1 = await win.webContents.executeJavaScript(detectPageState());
      if (state1 === 'MFA') { finish(new Error('MFA')); return; }
      if (state1 === 'NO_ACCOUNT') { finish(new Error('NO_ACCOUNT')); return; }
      if (state1 === 'BAD_PASSWORD') { finish(new Error('BAD_PASSWORD')); return; }
      const probe = JSON.parse(await win.webContents.executeJavaScript(PROBE_SCRIPT));
      if (probe.hasPassword) passDone = false;
      const wantEmail = !probe.hasPassword;
      const wantPass = probe.hasPassword && !passDone;
      if (wantEmail || wantPass) {
        const r = await win.webContents.executeJavaScript(FILL_SCRIPT(email, password, wantEmail, wantPass));
        const res = typeof r === 'string' ? JSON.parse(r) : r;
        if (res && res.email) onStatus && onStatus({ phase: 'filled', field: 'email' });
        if (res && res.password) { passDone = true; onStatus && onStatus({ phase: 'filled', field: 'password' }); }
        if (res && res.submitted === 'email') onStatus && onStatus({ phase: 'await-password' });
        else if (res && res.submitted === 'password') onStatus && onStatus({ phase: 'awaiting-token' });
      }
    } catch (e) {
      if (session.done) return;
    }
    if (ticks >= 60) finish(new Error('登录超时，请重试或改用设备码授权'));
  };
  session.timer = setInterval(fill, 700);
  fill();

  return { win, close: () => finish(new Error('closed')) };
}

module.exports = { openEmbeddedLogin, buildAuthorizeUrl, parseFragmentToken, parseAuthError, closeSession, isMicrosoftLoginUrl };
