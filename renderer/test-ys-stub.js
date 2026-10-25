/* LittleSkin 复现用 window.cube stub（evaluateOnNewDocument 注入，先于 renderer.js 执行）
 * 忠实复刻主进程 account:loginYggdrasil / skin:fetch / getState 的行为与数据形状 */
(function () {
  const YS_PORT = __YS_PORT__;
  const listeners = {};
  const state = {
    gameRoot: '/tmp/mock-game',
    launcherVersion: '1.0.0',
    sysMemoryMB: 16384,
    accounts: [],
    selectedAccount: null,
    settings: { selectedVersionId: '1.20.1', global: { memory: 4096, javaPath: '', width: 854, height: 480, fullscreen: false, jvmArgs: '', isolation: false, serverAddress: '', mirror: false, accent: 'pink' }, perVersion: {} },
    installed: [{ id: '1.20.1', type: 'release', time: '2023-06-12', fabric: false }],
    running: false,
  };
  async function yggdrasilLogin({ apiRoot, username, password }) {
    const clientToken = 'mock-client-token';
    const authRes = await fetch(apiRoot + '/authserver/authenticate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent: { name: 'Minecraft', version: 1 }, username, password, clientToken, requestUser: true }),
    });
    if (!authRes.ok) {
      const err = await authRes.json().catch(() => ({}));
      throw new Error(err.errorMessage || '认证失败 (HTTP ' + authRes.status + ')');
    }
    const auth = await authRes.json();
    const profile = auth.selectedProfile;
    let skinUrl = null, model = 'default';
    try {
      const propRes = await fetch(apiRoot + '/api/user/properties', { headers: { Authorization: 'Bearer ' + auth.accessToken } });
      if (propRes.ok) {
        const props = await propRes.json();
        const tex = (props.properties || []).find((p) => p.name === 'textures');
        if (tex) {
          const decoded = JSON.parse(atob(tex.value));
          if (decoded.textures && decoded.textures.SKIN) {
            skinUrl = decoded.textures.SKIN.url;
            model = decoded.textures.SKIN.metadata && decoded.textures.SKIN.metadata.model === 'slim' ? 'slim' : 'default';
          }
        }
      }
    } catch (e) { /* 皮肤拉取失败不阻塞登录 */ }
    return { id: 'ys-' + profile.id, type: 'yggdrasil', name: profile.name, uuid: profile.id, apiRoot, accessToken: auth.accessToken, clientToken, skinUrl, model };
  }
  window.cube = {
    invoke: async (ch, ...args) => {
      switch (ch) {
        case 'launcher:getState': return JSON.parse(JSON.stringify(state));
        case 'versions:manifest': return { latest: { release: '1.20.1' }, versions: [{ id: '1.20.1', type: 'release', releaseTime: '2023-06-12', installed: true }] };
        case 'wiki:versionInfo': return { ok: true, info: { id: args[0], type: 'release', releaseTime: '2023-06-12', installed: true, fabric: false, javaMajor: 17, assetIndex: args[0], mainClass: 'net.minecraft.client.main.Main', clientSha1: 'a'.repeat(40), jarSize: 23456789, inheritsFrom: null, wikiUrl: 'https://minecraft.wiki/w/' + args[0] } };
        case 'wiki:patchNotes': return { ok: true, notes: { found: false } };
        case 'skin:fetch': {
          const r = await fetch(args[0]);
          const buf = await r.arrayBuffer();
          const bytes = new Uint8Array(buf);
          let bin = '';
          for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
          return 'data:image/png;base64,' + btoa(bin);
        }
        case 'account:loginYggdrasil': {
          const acc = await yggdrasilLogin(args[0]);
          state.accounts.push(acc); state.selectedAccount = acc;
          const { accessToken, ...rest } = acc;
          return rest;
        }
        case 'account:loginOffline': {
          const acc = { id: 'off-1', type: 'offline', name: args[0], uuid: '00000000-0000-0000-0000-000000000000', skinUrl: null, capeUrl: null, model: null };
          state.accounts.push(acc); state.selectedAccount = acc;
          return acc;
        }
        case 'settings:save': return JSON.parse(JSON.stringify(state));
        case 'versions:select': state.settings.selectedVersionId = args[0]; return JSON.parse(JSON.stringify(state));
        case 'game:launch': return { ok: true };
        case 'game:stop': return { ok: true };
        case 'download:search': return { source: args[0].source, category: args[0].category, total: 0, items: [] };
        case 'updater:check': return { ok: true, info: { hasUpdate: false, current: '1.0.0', latest: '1.0.0', notes: '', publishedAt: '', url: '', asset: null } };
        case 'shell:openExternal': return { ok: true };
        case 'shell:openPath': return { ok: true };
        case 'dialog:pickGameRoot': return null;
        case 'launcher:setGameRoot': return { ok: true, state: JSON.parse(JSON.stringify(state)) };
        case 'launcher:migrateGameRoot': return { ok: true, state: JSON.parse(JSON.stringify(state)) };
        default: return null;
      }
    },
    on: (ch, cb) => { (listeners[ch] = listeners[ch] || []).push(cb); },
    getPathForFile: (f) => f.name,
  };
})();
