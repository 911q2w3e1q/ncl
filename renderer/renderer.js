/* NCL — Nexus Craft Launcher 渲染层逻辑
 * 在 Electron 中通过 window.cube 与主进程通信；
 * 在浏览器中直接打开 index.html 时自动进入 mock 预览模式（假数据，方便看界面）。
 */
'use strict';

/* ================= 默认皮肤（离线账户头像） ================= */
const DEFAULT_SKINS = {
  steve: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAEwElEQVR4Xu1av2sUURgMqCABQQVBBK0SCdooMQQD5jSFkNgpKdIEwSZoZ6GYJohNUmlhqrSxsUlhYZM/If/TmdncrLOz3+7drcneXtyB4f36bvNm3vd2l32ZmOiD+3eudMHZqWtJyTrbn189LqVfb+xAwZ17N1LxqLsBH17MZniuDFDBXn5b6+TEkxjz640dXLSmP8r/wgDd+74VILJoC5wLA3TFNRsgHqRQv/mh7+v64vkwwO8BSoiE4KLSrzd2UNF+QwQpdnn6aobs9+s1DpraFDZ183Im5ZkFSjVBf6PX0WtEcSh9PrUjmiBIIVpX8V7yd5Foxvn10efzqR0qwifMvr03y91fn9a7v7+8S8qf79eSvkfT13OxINvs0zpNYJ/Pp3ZwQjpRXUkIhWAIp3gSY5Go6JqsM55tn0/t0ImxxCMM4iACQoGXT3ZS0agDaCMGffhNdC0aGhnUCAN8hShIyRV/+/RBQs0AJUX5yuv9QQ1B2+dTOzgRlFx5PsO/v15MX2jwaPu4NJdw6fZkJoaPPGaCXtMN8LbPp3bwrU3FuwkoIRomsKRoGqS/5fX0zfDurckM2e/zGTkWHu50lfPz8wlnZmYSenwOR0fp9lBj0Ycxv77TL5fDwUE34f5+Znt6WGX4hCicRnh8DsciVbyacNoGqNEeVhk+oSoZcNYGTB4epgY0MgPOdAscC9ct8M8Z8Gxurwvij6N8vvAjJftYkjp+cXc3Q0/PVHxv4kXxYKafQpW9uLS9tZWlxg4KChzUAB0HMdlL29sJU0E9oUxP74/iMyK9j/2RARsbJ6QBHB8UZQI9O3wchJALm5sJUdcURel9Hu8muFkZ8WJGMlZkADgoygQWGaB1iiH7CfL4UJi0c2mupHg1gRwULpDtqE/HSBeUWXEzQFc/MiC39/f/3uh4s9N6RI67zkK4Ab7CkSHa9pRODegJcQM83jMkFd9r66OON1Rtq+hKj8XIAN8GZeMURXoK66p6bBTvv3VhKj4ygKXrLASFFQnsZwAmqWKSDNAVZTb0BHl8aIDED2oAykoZ4OmtwpUeR1KQiqNwF8cYj8sYIOIR4yvrBqgRlQxYWVnpgn5zczLOqaIiM1Sgx6YGiGgVD6rgoizQLTC0AXi97XQ6GVGrq6s5oYjxWNR1i6hhmjk0gsI8RrePxiATIwM0K9wAlq6zEHzHpzgXSOFRHOpqAKnbiCVX1OP9XsMY9pcJ1/3vRrjOFi1atGjRosX4AR9Ai5h5fT44+ViajrVo0aJFixYtWtQN/5Q29OGqfELTDyEe1li4AUMfr4sBmZPlcYEbUCUD+JrLDBhrAypnwHFZ6airbujXX//I6WM6zpjcgaefEbDtbAoGEcls8DEwPOJWA9wEtpsCNwClG6Dj/QxID0vcCK83BS7QRfq49iUGlJ3xl5HQTOmZ498NnKdqoItnO+rTMdLP9/XG5wce2u/zGBmKBPtq67jGu1h99Hm7kY/FSGC/LaB0A4pEs5+lz2NkcIEoIwMic8DofM/Fq/DGZYCnv6+09kfbJNrnkXDv93mMDDxJpsAi+nE7WSY+Et44A3hcrqKG+f+CyAAV7Qaw7fMYGaL/G1CBFB7FoQ5BRfeByAiO+zyq4g8lK5z2I+oYkQAAAABJRU5ErkJggg==',
  alex: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAIAElEQVR42uWa728URRjH968wanznj5DoC9BASIopJFKgHFIbCUmlNQVLGhoDoqRa0rQaAgJFDRoSEuGNJmITrVrPKIgmGo0EXlg1/CYkBIwoUOUtL9b7Pt3v9NnnZq/X2722XDf5ZmZndu/2+5lnZnd2Nggm2K4dXBaK9tWHRflCerb/8ZIKUm6XD+bGNLC0OF9IR/oWllTqTZslgIvvLpL0r0M5Z3Rwd1tMmQFQZgng9P4lkl451OyMfrS7PabsAESGYZYgBEAEhObf394UEyFkEQEwDLMEIQAiIDR/sKc5JkLIJAJiAFQ3QHnVAUSGHQDVDVA+JQAgAaC6A/YB4PLPH1QdACQAVHfAPgBc+unDKgMwg57u/1DVAZhBT/d/qOoAXH/XdwEVBQTgUxYAXH/XdwEVBQTgUyYA9ODHVrddoJTS/r8e/NjqtguUUtkhTqM0afu8Sz23Rd9xGpwv5e9rczq0bZ93qee26DtOg/Ol/P0g0UjChXMMsGaSoLlyTxShLNFIwoVzDLBmkqC5ck8UoSwodeHWKMz/8/uwKNbSBGZa3oLRUcbfLHXh1ijMX/8tL4q1NIGZlrdgdJQ5ALZV2bdZxjzN3z5/NLx68mORHhTdb+hWNpB83cK2qr0D6A3G/z33bcljYq1sIPm6RRALadPKyMPonTt3wgfXPyTmb1/6QfIoQ51+Kiw1JmjAOh8L6cgMWxnby40PBIX/CuZvX+BMIo8y1OnHZd9t044XOrKQd7c5try0csGkmC3o1umvwtFzx5x5SS8cD2+d+UbyBOU16ukWsf2CeJvjqC6tfPFHaWnb2iy3UeEgWqOebhHbly5g+jzDXMzScJSOHvtcRDiE5SAkjPR6ULVji+3zDHMxSxBRevP4sIhwCMtBSBjp9aBqx5bYkx5DX0eAky5TcIrMT3Rb5HjBByl1wQx9HQFOukzBKTI/0W2RY05UVrS9sOSxUGvOnDkxTfRc0ZPvDnfuai96L0AAnUvnltSEvz/UHVJnj74nDYD0mXkPB1DqLSsAWgDA8M8EQP4uAcDHYeSrAYDmkW5aPDeAZgwAN5gWpMeGLLtAJgAc0YgqLuK1NU+G/S2Lwxcbn5B9gGA68N0eUe8XPSJ3bnQ+6iwA+zTonXeY2+jr+b5w79E3Q93i/H2Uy3+ba0c564OhoUBUTovzx2Fy69MLBACkzTO/OTdf4EA4Vl8AL3DP3o0xAIwCfSfg8XbuAeM07wBQ+W5nHv9j/5vnoG5SALRRGiSMpHoAEgCeFpIL3Nc5Pm9QzwDWEA1TbMEYABVlupVtBLB80gAo3RdpcLIAuoe2uW4CCBDNx7pMdJ6+aG0cxyLtf6Ml3LV7vQh5dK+33+mStFRdRQAY4jvbGkTI23o7aNkW0gAYqmL+yx5vSPsAOIAFXT1xJCZGFVSqbrB3YwBNuNXV1YUUDb767CIRW14f09DQEFMsAgopTWtT2lwMwFC8T2sATK05/RiuQbCOadkAVqxYEVIw2NLSEra2toqQR5k+ZtWqVeHatWtFyFsAtvWtIdtldIszz3MJQJslgOu/Dsn+jT++LsxKByXVj+oVAYDa29vDrq4uEfK2vghAPt4FeOHsCtpMDIA5Xh+rz4ExGkV6fWQcwui541J+7eQn4ej578fhjAxPHgBb2gdAR4EFcO/Ce8L76+9z6er+XAyAHhNQh2N8x8uxn70SOwd1MKglAKLJGPZhnHVukjaZCIAJqLm52XWBDRs2iNgFUMfjGhsbw6amJhHyOvyRwhilzXJfD4CQrddwIJqDUWllmrz8SzGAQhnq/i7kD2x+LoAmBWDdunVFEYCyyQCwfZ63s9gY4Dnejhssp3GaFZORUdaxnuVQ2QDq6+tDCmbR8lu2bBEhjzJ9zPLly8NcLidC3vc4irvHtqaFMaFM7gL5ZABWqBPjUV93AFQX0FFQEYDp2jo6Oio7cWAgCAYHJcXkh9PgzKbDM36D+VOnJOUMcHYCKEQATRNEJu8DZvymuoA1X5sA2tqCYNOmce3YMQYB0uXQ/v1j6ukZ112/rVwZBJ2dY+rrG5vhHTkSBIcPj+1Dug4iCKgmIkADgHkanZUA0PIwOVsiYOtTjwYHnl8i2rWmLuAzPoR9iPUsf6tzjVNNAsATnqSqvGYBdNQ94gUgmm0AtEkLQHePmgRgW1kDsONDTY4BFoAeA2x09LbmnGoaQNJdoCYBUDCF0Eb60rJ5Qe/qBU4sn1YAaRdXZfXIs/xd9mSHk6Voujzl7wvSAtBLaBUBgPkIxLS8L8gCANYS7fJ32QYIoJBOy/uC1ABg3vMBRNkApvp9gf1+AN8UcPFUL6vr5XW98KFfkLL1Sy2j4Rwc4yY+0/2+wK4ec2XZri4nfl+gDPL7gaKl8VLr/3hfwI0zQkYCZ4u6LuvZogUAU0hhkKvLZS2vm/V/3xcg3vV/RIAGgPcF2PR0udoA9NI5vzDxhb8PQOr1fwsAxrHpFyZTBaCS7wvSrv/jQYkb5wOMAD4pYqvabDHt9wVp1/+TAOi5QlUBpP2+IGn9n2b18rhv/R+zxRkDoJLvC7RBrAHq9X+WY/0/CcCVM58GN/88IUL+6oXh4L8bI5JyX+dZlzmASr8vmGj9P6nOFwFsZcmr9wU6OjKPgLTfFxSt8EYGYTapzkZAUiuXqststpj2+wK99u9MqvV/DcHVFeQbBHUE6PcFdgzIdLqc9vsCGGNft2v83k9gPAB87wtQV877gv8BjY2wPg7jcKEAAAAASUVORK5CYII=',
};

/* ================= mock 预览模式 ================= */
const mockState = {
  gameRoot: '/预览模式',
  launcherVersion: '1.4.0',
  sysMemoryMB: 16384,
  accounts: [{ id: 'mock-1', type: 'offline', name: 'Steve', uuid: '8f14e45f-ceea-467a-9f0c-8b8b0b0a1b2c', skinUrl: null, capeUrl: null, model: null }],
  selectedAccount: { id: 'mock-1', type: 'offline', name: 'Steve', uuid: '8f14e45f-ceea-467a-9f0c-8b8b0b0a1b2c', skinUrl: null, capeUrl: null, model: null },
  settings: {
    selectedVersionId: '1.20.1',
    global: { memory: 4096, javaPath: '', width: 854, height: 480, fullscreen: false, jvmArgs: '', isolation: false, serverAddress: '', mirror: false, accent: 'pink', background: '', backgroundName: '', gameRoot: '/预览模式/.minecraft', gameRootPrev: '/预览模式/旧目录', ai: { enabled: true, baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-mock-key', model: 'gpt-4o-mini', autoAnalyze: true } },
    perVersion: {},
  },
  installed: [
    { id: '1.20.1', type: 'release', time: '2023-06-12', fabric: false, loader: null, mc: '1.20.1' },
    { id: '1.16.5', type: 'release', time: '2021-01-15', fabric: false, loader: null, mc: '1.16.5' },
    { id: 'fabric-loader-0.16.9-1.20.1', type: 'release', time: '2024-06-01', fabric: true, loader: 'fabric', mc: '1.20.1' },
  ],
  running: false,
};
const mockManifest = {
  latest: { release: '26.3', snapshot: '26.4-snapshot-5' },
  versions: [
    { id: '26.3', type: 'release', releaseTime: '2026-09-15', installed: true },
    { id: '26.2', type: 'release', releaseTime: '2026-06-16' },
    { id: '26.1.2', type: 'release', releaseTime: '2026-04-09' },
    { id: '26.4-snapshot-5', type: 'snapshot', releaseTime: '2026-10-20' },
    { id: '1.21.4', type: 'release', releaseTime: '2024-12-03' },
    { id: '1.21.1', type: 'release', releaseTime: '2024-08-08' },
    { id: '1.20.1', type: 'release', releaseTime: '2023-06-12', installed: true },
    { id: '1.16.5', type: 'release', releaseTime: '2021-01-15', installed: true },
    { id: '1.12.2', type: 'release', releaseTime: '2017-09-18' },
    { id: '1.7.10', type: 'release', releaseTime: '2014-05-14' },
    { id: '1.21.4-rc3', type: 'old_beta', releaseTime: '2024-11-28' },
    { id: 'b1.7.3', type: 'old_alpha', releaseTime: '2011-03-08' },
    { id: 'fabric-loader-0.16.9-1.20.1', type: 'release', releaseTime: '2024-06-01', installed: true },
  ],
};
const mockListeners = {};
/* 下载页 mock 数据（浏览器预览用） */
const mockDLItems = [
  { id: 'sodium', title: 'Sodium', summary: '现代渲染引擎，大幅提升游戏帧数与兼容性', author: 'jellysquid3', downloads: 128000000, tags: ['fabric', '优化'], versions: ['1.21.4', '1.21.1'], icon: '' },
  { id: 'iris', title: 'Iris & Sodium 光影', summary: '兼容 OptiFine 光影包的 Fabric 光影模组', author: 'IMS212', downloads: 46000000, tags: ['fabric', '光影'], versions: ['1.21.4', '1.20.1'], icon: '' },
  { id: 'create', title: 'Create 机械动力', summary: '添加大量机械结构与自动化装置的科技模组', author: 'simibubi', downloads: 92000000, tags: ['forge', '科技'], versions: ['1.20.1', '1.19.2'], icon: '' },
  { id: 'jei', title: 'JEI 物品管理器', summary: '查看物品合成表与用途的物品管理工具', author: 'mezz', downloads: 210000000, tags: ['forge', 'fabric', '工具'], versions: ['1.21.4', '1.16.5'], icon: '' },
  { id: 'fabric-api', title: 'Fabric API', summary: 'Fabric 模组的基础依赖库，大多数 Fabric 模组都需要', author: 'FabricMC', downloads: 180000000, tags: ['fabric', '库'], versions: ['1.21.4', '1.20.1'], icon: '' },
  { id: 'lithium', title: 'Lithium 服务端优化', summary: '不改变游戏逻辑的服务器性能优化模组', author: 'jellysquid3', downloads: 38000000, tags: ['fabric', '服务端'], versions: ['1.21.4', '1.20.4'], icon: '' },
  { id: 'terralith', title: 'Terralith 世界生成', summary: '重写世界生成，新增 100 余种生物群系与结构', author: 'Starmute', downloads: 24000000, tags: ['fabric', '世界生成'], versions: ['1.21.4', '1.20.1'], icon: '' },
  { id: 'supplementaries', title: 'Supplementaries 装饰', summary: '为原版增添大量实用小物件与装饰方块', author: 'MehVahdJukaar', downloads: 31000000, tags: ['forge', 'fabric', '装饰'], versions: ['1.20.1', '1.19.2'], icon: '' },
];
const mockDLDetail = (id) => {
  const base = mockDLItems.find((m) => m.id === id) || mockDLItems[0];
  const mkVersions = (v, date, gvs) => ({ id: `${id}-${v}`, number: v, name: v, date, gameVersions: gvs, loaders: base.tags.includes('fabric') ? ['fabric'] : ['forge'], url: 'https://example.invalid/mock.jar', fileName: `${id}-${v}.jar`, sha1: '', size: 2345678 });
  const versions = [mkVersions('2.1.0', '2025-03-18', ['1.21.4', '1.21.1']), mkVersions('2.0.9', '2025-01-22', ['1.21.4', '1.21.1']), mkVersions('1.9.4', '2024-06-10', ['1.20.1', '1.19.2']), mkVersions('0.8.2', '2023-02-14', ['1.18.2', '1.16.5'])];
  const sorted = [...versions].sort((a, b) => a.date.localeCompare(b.date));
  return {
    id: base.id, source: 'modrinth', title: base.title, summary: base.summary,
    icon: base.icon, author: base.author, downloads: base.downloads, tags: base.tags,
    url: 'https://modrinth.com/mod/' + base.id,
    gameVersions: ['1.21.4', '1.21.1', '1.20.1', '1.19.2', '1.18.2', '1.16.5'], loaders: base.tags.includes('fabric') ? ['fabric'] : ['forge'],
    versions, latest: sorted[sorted.length - 1], oldest: sorted[0],
  };
};
const mockApi = (channel, ...args) => new Promise((resolve) => {
  setTimeout(() => {
    switch (channel) {
      case 'launcher:getState': resolve(JSON.parse(JSON.stringify(mockState))); break;
      case 'versions:manifest': resolve(mockManifest); break;
      case 'wiki:versionInfo': {
        const id = args[0] || '1.20.1';
        const entry = mockManifest.versions.find((v) => v.id === id);
        const isSnap = entry ? entry.type === 'snapshot' : /snapshot|pre|rc\d/.test(id);
        resolve({
          ok: true,
          info: {
            id,
            type: entry ? entry.type : (isSnap ? 'snapshot' : 'release'),
            releaseTime: entry ? entry.releaseTime : '2023-06-12',
            installed: entry ? !!entry.installed : false,
            fabric: false,
            javaMajor: 17,
            assetIndex: id,
            mainClass: 'net.minecraft.client.main.Main',
            clientSha1: 'a1b2c3d4e5f60718a1b2c3d4e5f60718a1b2c3d4',
            jarSize: 23456789,
            inheritsFrom: null,
            wikiUrl: 'https://minecraft.wiki/w/Java_Edition_' + id,
          },
        });
        break;
      }
      case 'skin:fetch': resolve(DEFAULT_SKINS.steve); break;
      case 'account:loginOffline': {
        const acc = { id: 'mock-' + Date.now(), type: 'offline', name: args[0], uuid: '00000000-0000-0000-0000-000000000000', skinUrl: null, capeUrl: null, model: null };
        mockState.accounts.push(acc); mockState.selectedAccount = acc; resolve(acc); break;
      }
      case 'account:loginYggdrasil': {
        const acc = { id: 'mock-ys', type: 'yggdrasil', name: 'LittleSkinPlayer', uuid: '069a79f4-44e9-4726-a5be-fca90e38aaf5', apiRoot: args[0].apiRoot, skinUrl: null, capeUrl: null, model: 'slim' };
        mockState.accounts.push(acc); mockState.selectedAccount = acc; resolve(acc); break;
      }
      case 'account:loginMicrosoft': {
        setTimeout(() => (mockListeners['launcher://ms-code'] || []).forEach((cb) => cb({ userCode: 'ABC123XY', verificationUri: 'https://www.microsoft.com/link', message: '' })), 250);
        setTimeout(() => {
          const acc = { id: 'mock-ms', type: 'microsoft', name: 'MsPlayer', uuid: '069a79f4-44e9-4726-a5be-fca90e38aaf6', xuid: '1234567890', skinUrl: null, capeUrl: null, model: 'default', lastLoginAt: Date.now() };
          mockState.accounts.push(acc); mockState.selectedAccount = acc;
          resolve({ ok: true, account: acc });
        }, 1800);
        break;
      }
      case 'account:select': { mockState.selectedAccount = mockState.accounts.find((a) => a.id === args[0]); resolve(mockState); break; }
      case 'account:remove': { mockState.accounts = mockState.accounts.filter((a) => a.id !== args[0]); resolve(mockState); break; }
      case 'versions:select': { mockState.settings.selectedVersionId = args[0]; resolve(mockState); break; }
      case 'versions:loaderCatalog': resolve({
        ok: true,
        catalog: {
          forge: { '26.3': '58.1.0', '1.21.4': '54.1.3', '1.21.1': '52.1.0', '1.20.1': '47.1.3', '1.20.4': '49.0.19', '1.19.2': '43.3.13' },
          neoforge: { '1.21.4': '21.4.100', '1.21.1': '21.1.72', '1.20.4': '20.4.100' },
          quilt: { '1.21.4': '0.29.3', '1.21.1': '0.28.1', '1.20.1': '0.23.0' },
        },
      }); break;
      case 'versions:installLoader': {
        const { loader, mc } = args[0] || {};
        const verMap = { forge: '47.1.3', neoforge: '20.4.100', quilt: '0.23.0' }[loader] || '1.0.0';
        const id = loader === 'forge' ? `${mc}-${verMap}` : loader === 'neoforge' ? `neoforge-${verMap}` : `quilt-loader-${verMap}-${mc}`;
        mockState.installed.push({ id, type: 'release', time: '2026-01-01', fabric: false, loader, mc });
        resolve({ ok: true, id }); break;
      }
      case 'theme:pickBackground': {
        mockState.settings.global.background = 'mock:';
        mockState.settings.global.backgroundName = 'mock-像素晚霞.svg';
        resolve({ ok: true, background: 'mock:', backgroundName: 'mock-像素晚霞.svg' }); break;
      }
      case 'theme:resetBackground': {
        mockState.settings.global.background = '';
        mockState.settings.global.backgroundName = '';
        resolve({ ok: true }); break;
      }
      case 'settings:save': {
        const patch = args[0] || {};
        if (patch.global) Object.assign(mockState.settings.global, patch.global);
        if (patch.perVersion) Object.assign(mockState.settings.perVersion, patch.perVersion);
        resolve(mockState); break;
      }
      case 'content:importFile': resolve({ ok: true, name: 'mock-file.jar', path: '/预览模式' }); break;
      case 'content:importPath': resolve({ ok: true, name: String((args[0] || {}).filePath || '').split(/[\\/]/).pop() || 'mock-file', path: '/预览模式' }); break;
      case 'game:launch': {
        resolve({ ok: true });
        const lines = ['[NCL] 预览模式：模拟启动中…', 'Setting user: Steve', 'Loaded 88 libraries', 'LWJGL Version: 3.3.3', 'Backend library: LWJGL 3.3.3 SNAPSHOT', 'OpenAL initialized.', 'Narrator library loaded.', 'Created: 1024x512 textures-atlas'];
        lines.forEach((l, i) => setTimeout(() => (mockListeners['launcher://game-log'] || []).forEach((cb) => cb(l)), 350 * (i + 1)));
        setTimeout(() => (mockListeners['launcher://game-exit'] || []).forEach((cb) => cb({ code: 0, signal: null })), 350 * (lines.length + 1) + 800);
        break;
      }
      case 'game:stop': {
        setTimeout(() => (mockListeners['launcher://game-exit'] || []).forEach((cb) => cb({ code: 0, signal: null })), 120);
        resolve({ ok: true }); break;
      }
      case 'ai:getConfig': resolve({
        ok: true,
        enabled: !!mockState.settings.global.ai.enabled,
        baseUrl: (mockState.settings.global.ai && mockState.settings.global.ai.baseUrl) || 'https://api.openai.com/v1',
        model: (mockState.settings.global.ai && mockState.settings.global.ai.model) || 'gpt-4o-mini',
        apiKeyMasked: (mockState.settings.global.ai && mockState.settings.global.ai.apiKey) ? 'sk-a****b123' : '',
        hasKey: !!(mockState.settings.global.ai && mockState.settings.global.ai.apiKey),
        autoAnalyze: mockState.settings.global.ai ? mockState.settings.global.ai.autoAnalyze !== false : true,
      }); break;
      case 'ai:setConfig': {
        const patch = args[0] || {};
        if (!mockState.settings.global.ai) mockState.settings.global.ai = {};
        Object.assign(mockState.settings.global.ai, patch);
        resolve({ ok: true, config: mockState.settings.global.ai }); break;
      }
      case 'ai:test': resolve({ ok: true, message: '连接成功：OK（预览模式）' }); break;
      case 'ai:analyze': {
        const payload = {
            trigger: 'manual', ok: true,
            analysis: {
              summary: '示例：Java 内存不足导致 OutOfMemoryError，建议把内存上限调到 4GB。',
              confidence: 'high',
              causes: [
                { title: '内存不足', detail: '日志中出现 java.lang.OutOfMemoryError: Java heap space，当前分配的 2GB 无法满足模组需求。' },
                { title: '模组负载偏高', detail: '同时加载了 30+ 模组，实体与区块占用较大。' },
              ],
              solutions: [
                { title: '把内存上限提高到 4GB', detail: '在版本设置里把内存上限从 2GB 调为 4096MB。', risk: 'low', actions: [{ type: 'setMemory', target: '*', value: '4096', description: '内存上限改为 4096 MB' }] },
                { title: '追加 G1GC 参数', detail: '为大堆启用 G1GC，降低停顿并改善内存回收。', risk: 'low', actions: [{ type: 'setJvmArgs', target: '*', value: '-XX:+UseG1GC', description: '追加 JVM 参数 -XX:+UseG1GC' }] },
                { title: '关闭版本隔离', detail: '让该版本与其他版本共用游戏目录。', risk: 'medium', actions: [{ type: 'setIsolation', target: '*', value: 'false', description: '关闭版本隔离' }] },
              ],
              actions: [],
            },
            versionId: mockState.settings.selectedVersionId || '1.20.1',
        };
        setTimeout(() => {
          (mockListeners['launcher://ai-analysis'] || []).forEach((cb) => cb(payload));
        }, 400);
        resolve({ ok: true, analysis: payload.analysis, error: null }); break;
      }
      case 'ai:applyActions': {
        const actions = (args[0] && args[0].actions) || [];
        const applied = actions.map((a) => ({ action: a, description: a.description || a.type }));
        resolve({ ok: true, applied, failed: [], gameDir: '/预览模式' }); break;
      }
      case 'ai:rollback': resolve({ ok: true }); break;
      case 'shell:openPath': resolve({ ok: true }); break;
      case 'dialog:pickGameRoot': resolve('/预览模式/新的游戏目录'); break;
      case 'launcher:setGameRoot': { mockState.gameRoot = args[0]; mockState.settings.global.gameRootPrev = '/预览模式/.minecraft'; mockState.settings.global.gameRoot = args[0]; resolve({ ok: true, state: JSON.parse(JSON.stringify(mockState)) }); break; }
      case 'launcher:migrateGameRoot': { mockState.settings.global.gameRootPrev = ''; resolve({ ok: true, state: JSON.parse(JSON.stringify(mockState)) }); break; }
      case 'wiki:patchNotes': {
        const id = args[0] || '1.20.1';
        resolve({
          ok: true,
          notes: {
            found: true,
            entry: {
              title: `Java Edition ${id}`,
              type: 'release',
              version: id,
              image: null,
              body:
                '<p><strong>更改</strong></p>' +
                `<p>${id} 是 Minecraft 的一个版本更新（此为浏览器预览用的示例正文，实际内容来自 Mojang 官方更新日志）。</p>` +
                '<ul><li>新增与调整的游戏特性</li><li>方块、物品与生物的改动</li><li>技术性更改与漏洞修复</li></ul>' +
                '<p>更多细节可点击下方按钮前往 Minecraft Wiki 查看完整条目。</p>',
            },
          },
        });
        break;
      }
      case 'updater:check': {
        const noUpd = new URLSearchParams(location.search).get('upd') === 'noupd';
        resolve({
          ok: true,
          info: {
            hasUpdate: !noUpd,
            current: '1.3.0',
            latest: noUpd ? '1.3.0' : '1.4.0',
            notes: noUpd ? '' : '## NCL 1.3.0\n\n- 新增：启动器检查更新后可一键下载并安装\n- 优化：版本弹窗 Fabric 列表支持全量搜索\n- 修复：切换游戏目录后旧数据迁移入口\n\n[查看完整说明](https://github.com/911q2w3e1q/ncl/releases)',
            publishedAt: new Date().toISOString(),
            url: 'https://github.com/911q2w3e1q/ncl/releases/latest',
            asset: noUpd ? null : { name: 'NCL-1.3.0-win64.zip', size: 140000000, url: 'https://example.invalid/mock.zip' },
          },
        });
        break;
      }
      case 'updater:download': {
        let p = 0;
        const timer = setInterval(() => {
          p += Math.random() * 22;
          (mockListeners['launcher://up-progress'] || []).forEach((cb) => cb({ stage: 'update', percent: Math.min(99, Math.round(p)), speed: 3.5 * 1048576, received: Math.min(99, Math.round(p)) * 1.4e6, total: 1.4e8, message: `下载 NCL-1.3.0-win64.zip ${Math.min(99, Math.round(p))}%` }));
        }, 350);
        setTimeout(() => {
          clearInterval(timer);
          (mockListeners['launcher://up-progress'] || []).forEach((cb) => cb({ stage: 'done', percent: 100, message: '下载完成', received: 1.4e8, total: 1.4e8 }));
          resolve({ ok: true, file: '/预览模式/NCL-1.3.0-win64.zip', info: { latest: '1.3.0' } });
        }, 2600);
        break;
      }
      case 'updater:apply': resolve({ ok: true }); break;
      case 'download:search': {
        const opts = args[0] || {};
        if (opts.category === 'vanilla') {
          const rel = mockManifest.versions.filter((v) => v.type === 'release');
          resolve({
            source: opts.source, category: 'vanilla', total: rel.length,
            items: rel.slice(0, 12).map((v) => ({ id: v.id, source: 'modrinth', title: v.id, summary: 'Mojang 正式版', icon: '', author: 'Mojang', downloads: 0, tags: ['release'], versions: [v.id], updated: v.releaseTime, installed: !!v.installed, url: '' })),
          });
        } else {
          resolve({
            source: opts.source, category: opts.category, total: mockDLItems.length,
            items: mockDLItems.map((m) => ({ ...m, source: 'modrinth' })),
          });
        }
        break;
      }
      case 'download:detail': resolve(mockDLDetail(args[0].id)); break;
      case 'download:install': resolve({ ok: true, result: { path: '/预览模式' } }); break;
      default: resolve(null);
    }
  }, 120);
});
const mockOn = (channel, cb) => { (mockListeners[channel] = mockListeners[channel] || []).push(cb); };

const api = window.cube
  ? (ch, ...a) => window.cube.invoke(ch, ...a)
  : mockApi;
const onEvent = window.cube ? (ch, cb) => window.cube.on(ch, cb) : mockOn;

/* ================= 全局状态 ================= */
let state = null;
let manifestCache = null;
let installing = null; // { id, percent }
let logLines = 0;
let currentPage = 'game'; // 当前激活页面（refresh 时按需同步对应子页面）

const $ = (id) => document.getElementById(id);
const fmtBytes = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : (b / 1024).toFixed(0) + ' KB');
const fmtSpeed = (s) => (s >= 1048576 ? (s / 1048576).toFixed(1) + ' MB/s' : (s / 1024).toFixed(0) + ' KB/s');

function toast(msg, ok = false) {
  const t = $('toast');
  t.textContent = msg;
  t.className = ok ? 'ok' : '';
  t.hidden = false;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => (t.hidden = true), 3600);
}

/* ================= 头像绘制（皮肤 → 头部） ================= */
function drawAvatar(dataURL) {
  const canvas = $('avatar');
  const ctx = canvas.getContext('2d');
  const W = (canvas.width = 216), H = (canvas.height = 216);
  ctx.clearRect(0, 0, W, H);
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#f3f4f6'); g.addColorStop(1, '#e5e7eb');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const img = new Image();
  img.onload = () => {
    ctx.imageSmoothingEnabled = false;
    const is64 = img.height >= 64;
    const scale = 25, off = 8, size = 8 * scale;
    try {
      ctx.drawImage(img, 8, 8, 8, 8, off, off, size, size);
      if (is64) ctx.drawImage(img, 40, 8, 8, 8, off, off, size, size);
    } catch { /* 非标准皮肤尺寸 */ }
  };
  img.onerror = () => {
    ctx.fillStyle = '#2a3448';
    ctx.font = '72px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('?', W / 2, H / 2 + 1);
  };
  img.src = dataURL || DEFAULT_SKINS.steve;
}

/* ================= 账户卡片 ================= */
async function renderAccountCard() {
  const acc = state.selectedAccount;
  const nameEl = $('acc-name'), typeEl = $('acc-type'), uuidEl = $('acc-uuid'), texEl = $('acc-tex');
  if (!acc) {
    nameEl.textContent = '未登录';
    typeEl.textContent = '离线'; typeEl.className = 'badge badge-offline';
    uuidEl.textContent = '—';
    texEl.innerHTML =
      '<span class="tex-item">皮肤模型：<b>—</b></span>' +
      '<span class="tex-item">披风：<b>—</b></span>' +
      '<span class="tex-item" id="acc-api">接口：—</span>';
    $('btn-account').textContent = '登录账户';
    drawAvatar(DEFAULT_SKINS.steve);
    return;
  }
  nameEl.textContent = acc.name;
  const isYs = acc.type === 'yggdrasil';
  const isMs = acc.type === 'microsoft';
  typeEl.textContent = isMs ? '微软正版' : isYs ? 'LittleSkin' : '离线账户';
  typeEl.className = 'badge' + (isYs || isMs ? '' : ' badge-offline');
  uuidEl.textContent = acc.uuid;
  texEl.innerHTML =
    `<span class="tex-item">皮肤模型：<b>${acc.model === 'slim' ? 'Alex（纤细）' : acc.model === 'default' ? 'Steve（经典）' : '默认'}</b></span>` +
    `<span class="tex-item">披风：<b>${acc.capeUrl ? '已佩戴' : '无'}</b></span>` +
    `<span class="tex-item">上次登录：<b>${acc.lastLoginAt ? new Date(acc.lastLoginAt).toLocaleString('zh-CN', { hour12: false }) : '本地'}</b></span>` +
    '<span class="tex-item" id="acc-api"></span>';
  // 注意：acc-api 必须放进上面的 innerHTML 模板。此前模板里漏了它，
  // innerHTML 重建会把原 acc-api 元素销毁，再引用就空引用崩溃（LittleSkin 登录报错根因）。
  const apiEl = $('acc-api');
  if (apiEl) apiEl.textContent = '接口：' + (isMs ? 'Microsoft' : isYs ? acc.apiRoot : '离线模式');
  $('btn-account').textContent = '管理账户';
  if (acc.skinUrl) {
    try { drawAvatar(await api('skin:fetch', acc.skinUrl)); } catch { drawAvatar(null); }
  } else {
    drawAvatar(DEFAULT_SKINS.steve);
  }
}

/* ================= 版本卡片 ================= */
function renderVersionCard() {
  const vid = state.settings.selectedVersionId;
  const inst = state.installed.find((v) => v.id === vid);
  $('ver-id').textContent = vid || '未选择版本';
  $('ver-type').textContent = inst ? (inst.fabric ? 'Fabric' : '原版') : '—';
  const st = $('ver-status');
  if (!vid) { st.textContent = '请选择版本'; st.className = 'ver-status'; }
  else if (inst) { st.textContent = '已安装'; st.className = 'ver-status ok'; }
  else { st.textContent = '未安装（启动时自动下载）'; st.className = 'ver-status'; }
  $('launch-hint').textContent = vid ? `当前版本 ${vid}` : '未选择版本';
}

/* ================= 版本设置卡片（点击打开设置弹窗） ================= */
/* 内存滑块上限：按系统实际内存封顶（与主进程 safeMemoryMB 同一口径：至少给系统留 512MB） */
function sysMemMaxGB() {
  const sysMB = (state && state.sysMemoryMB) || 8192;
  return Math.max(2, Math.min(32, Math.floor((sysMB - 512) / 1024)));
}
function currentVS() {
  const vid = state.settings.selectedVersionId;
  const g = state.settings.global;
  const p = (vid && state.settings.perVersion[vid]) || {};
  return { ...g, ...p };
}
function renderSettingsCard() {
  const vs = currentVS();
  const maxGB = sysMemMaxGB();
  const memGB = Math.max(1, Math.min(maxGB, Math.round((vs.memory || 2048) / 1024)));
  const slider = $('set-memory');
  slider.max = maxGB;
  slider.value = memGB;
  $('set-memory-val').textContent = memGB + ' GB';
  $('set-width').value = vs.width;
  $('set-height').value = vs.height;
  $('set-fullscreen').checked = !!vs.fullscreen;
  $('set-jvmargs').value = vs.jvmArgs || '';
  $('set-isolation').checked = !!vs.isolation;
  const js = $('set-java-status');
  if (vs.javaPath) {
    js.textContent = vs.javaPath;
    js.title = vs.javaPath;
  } else {
    js.textContent = state.settings.selectedVersionId
      ? '自动匹配 / 缺失时自动下载'
      : '选择版本后自动匹配';
    js.title = '';
  }
  // 黄卡摘要
  const javaText = vs.javaPath ? '手动指定' : '自动匹配';
  $('vsettings-summary').innerHTML =
    `<span class="ss-item">内存 <b>${memGB} GB</b></span><span class="ss-dot">·</span>` +
    `<span class="ss-item">Java <b>${javaText}</b></span><span class="ss-dot">·</span>` +
    `<span class="ss-item">窗口 <b>${vs.fullscreen ? '全屏' : vs.width + ' × ' + vs.height}</b></span>`;
  $('vsettings-version').textContent = state.settings.selectedVersionId ? `· ${state.settings.selectedVersionId}` : '';
}
function openVSettingsModal() {
  renderSettingsCard();
  $('modal-vsettings').hidden = false;
}
function bindSettings() {
  const save = (patch) => {
    const vid = state.settings.selectedVersionId;
    if (vid) api('settings:save', { perVersion: { [vid]: patch } });
    else api('settings:save', { global: patch });
  };
  $('set-memory').addEventListener('input', (e) => {
    $('set-memory-val').textContent = e.target.value + ' GB';
  });
  $('set-memory').addEventListener('change', (e) => save({ memory: Number(e.target.value) * 1024 }));
  $('set-width').addEventListener('change', (e) => save({ width: Number(e.target.value) }));
  $('set-height').addEventListener('change', (e) => save({ height: Number(e.target.value) }));
  $('set-fullscreen').addEventListener('change', (e) => save({ fullscreen: e.target.checked }));
  $('set-jvmargs').addEventListener('change', (e) => save({ jvmArgs: e.target.value }));
  $('set-isolation').addEventListener('change', (e) => save({ isolation: e.target.checked }));
  $('btn-pick-java').addEventListener('click', async () => {
    const info = await api('dialog:pickJava');
    if (info) { toast(`已选择 Java ${info.major}`, true); save({ javaPath: info.path }); refresh(); }
  });
}

/* ================= 启动器设置页（PCL 式结构：左分类 + 右卡片） ================= */
const ACCENTS = {
  pink:     { accent: '#ec4899', deep: '#db2777', tint: '#fdf2f8', border: '#fbcfe8' },
  red:      { accent: '#e5484d', deep: '#c93539', tint: '#fef2f2', border: '#fecaca' },
  orange:   { accent: '#f97316', deep: '#c2410c', tint: '#fff7ed', border: '#fed7aa' },
  yellow:   { accent: '#f59e0b', deep: '#b45309', tint: '#fffbeb', border: '#fde68a' },
  green:    { accent: '#22c55e', deep: '#15803d', tint: '#f0fdf4', border: '#bbf7d0' },
  cyan:     { accent: '#06b6d4', deep: '#0e7490', tint: '#ecfeff', border: '#a5f3fc' },
  blue:     { accent: '#3b82f6', deep: '#2563eb', tint: '#eff6ff', border: '#bfdbfe' },
  purple:   { accent: '#8b5cf6', deep: '#6d28d9', tint: '#f5f3ff', border: '#ddd6fe' },
  graphite: { accent: '#64748b', deep: '#475569', tint: '#f8fafc', border: '#cbd5e1' },
};
function applyAccent(name) {
  const a = ACCENTS[name] || ACCENTS.pink;
  const s = document.documentElement.style;
  s.setProperty('--accent', a.accent);
  s.setProperty('--accent-deep', a.deep);
  s.setProperty('--accent-tint', a.tint);
  s.setProperty('--accent-tint-border', a.border);
}
/* mock 模式（无 Electron 协议）下的演示背景：SVG 渐变 + 像素山丘 */
const MOCK_BG_DATAURI = "data:image/svg+xml," + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720">' +
  '<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">' +
  '<stop offset="0" stop-color="#1e3a8a"/><stop offset=".55" stop-color="#7c3aed"/><stop offset="1" stop-color="#ec4899"/>' +
  '</linearGradient></defs><rect width="1280" height="720" fill="url(%23sky)"/>' +
  '<circle cx="1050" cy="150" r="62" fill="#fde68a" opacity=".9"/>' +
  '<path d="M0 520 L180 380 L340 500 L520 350 L700 520 L880 420 L1060 540 L1280 440 L1280 720 L0 720 Z" fill="#0f172a" opacity=".82"/>' +
  '<path d="M0 600 L220 500 L420 610 L640 520 L900 620 L1120 540 L1280 610 L1280 720 L0 720 Z" fill="#020617" opacity=".9"/>' +
  '</svg>');
/** 应用主题：强调色（含顶部导航栏）+ 背景图片 */
function applyTheme(g) {
  applyAccent((g && g.accent) || 'pink');
  const layer = $('bg-layer');
  if (!layer) return;
  const bg = (g && g.background) || '';
  if (!bg) { layer.hidden = true; layer.style.backgroundImage = 'none'; document.body.classList.remove('has-bg'); return; }
  const url = bg === 'mock:' ? MOCK_BG_DATAURI : `ncl-bg://bg/${encodeURIComponent(bg)}`;
  layer.hidden = false;
  layer.style.backgroundImage = `url("${url}")`;
  document.body.classList.add('has-bg');
}
/** 背景图片展示名（设置页用） */
function bgDisplayName(g) {
  const bg = (g && g.background) || '';
  if (!bg) return '默认背景';
  return (g && g.backgroundName) || bg;
}
const ACCOUNT_TYPE_LABELS = { offline: '离线', yggdrasil: 'LittleSkin', microsoft: '微软正版' };

function renderSettingsPage() {
  if (!state || !state.settings) return;
  const g = state.settings.global || {};
  // 内存
  const maxGB = sysMemMaxGB();
  const memGB = Math.max(1, Math.min(maxGB, Math.round((g.memory || 2048) / 1024)));
  const spMem = $('sp-memory');
  spMem.max = maxGB;
  spMem.value = memGB;
  $('sp-memory-val').textContent = memGB + ' GB';
  const pct = ((memGB - 1) / (maxGB - 1)) * 100;
  spMem.style.setProperty('--range-pct', pct + '%');
  // Java
  const js = $('sp-java-status');
  if (g.javaPath) { js.textContent = g.javaPath; js.title = g.javaPath; $('sp-btn-java-auto').hidden = false; }
  else { js.textContent = '自动匹配 / 缺失时自动下载'; js.title = ''; $('sp-btn-java-auto').hidden = true; }
  // 窗口
  $('sp-width').value = g.width || 854;
  $('sp-height').value = g.height || 480;
  $('sp-fullscreen').checked = !!g.fullscreen;
  // 其他
  $('sp-jvmargs').value = g.jvmArgs || '';
  $('sp-isolation').checked = !!g.isolation;
  $('sp-server').value = g.serverAddress || '';
  $('sp-mirror').checked = !!g.mirror;
  // 主题（强调色 + 背景图片）
  applyTheme(g);
  document.querySelectorAll('.set-swatch').forEach((b) => b.classList.toggle('active', b.dataset.accent === (g.accent || 'pink')));
  // 背景图片卡片
  const bgName = $('sp-bg-name');
  if (bgName) { bgName.textContent = bgDisplayName(g); bgName.title = g.backgroundName || ''; }
  const bgReset = $('sp-btn-reset-bg');
  if (bgReset) bgReset.hidden = !g.background;
  // 启动器信息
  $('sp-gameroot').textContent = state.gameRoot || '—';
  $('sp-gameroot').title = state.gameRoot || '';
  // 有旧目录待迁移数据时才显示「迁移旧数据」
  const prev = (state.settings.global || {}).gameRootPrev;
  const mig = $('sp-btn-migrate-root');
  if (mig) mig.hidden = !prev;
  $('sp-about-version').textContent = 'v' + (state.launcherVersion || '1.0.0');
  // 账户
  const list = $('sp-account-list');
  const accs = state.accounts || [];
  if (!accs.length) list.innerHTML = '<span class="set-account-empty">尚未登录账户</span>';
  else {
    const cur = state.selectedAccount && state.selectedAccount.id;
    list.innerHTML = accs.map((a) => `
      <span class="set-account-chip${a.id === cur ? ' current' : ''}">
        ${esc(a.name)}<span class="sac-type">${ACCOUNT_TYPE_LABELS[a.type] || a.type}</span>
      </span>`).join('');
  }
}
function bindSettingsPage() {
  // 保存全局设置（版本级覆盖仍在游戏页「版本设置」）
  const save = (patch) => api('settings:save', { global: patch }).then(() => { Object.assign(state.settings.global, patch); });
  // 左分类切换
  document.querySelectorAll('.set-rail-item').forEach((btn) => {
    btn.onclick = () => {
      document.querySelectorAll('.set-rail-item').forEach((b) => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.set-pane').forEach((p) => p.classList.toggle('active', p.dataset.spane === btn.dataset.scat));
    };
  });
  // 内存滑块
  $('sp-memory').addEventListener('input', (e) => {
    const v = Number(e.target.value);
    $('sp-memory-val').textContent = v + ' GB';
    e.target.style.setProperty('--range-pct', ((v - 1) / (Number(e.target.max) - 1)) * 100 + '%');
  });
  $('sp-memory').addEventListener('change', (e) => save({ memory: Number(e.target.value) * 1024 }));
  // Java
  $('sp-btn-pick-java').addEventListener('click', async () => {
    const info = await api('dialog:pickJava');
    if (info) { toast(`已选择 Java ${info.major}`, true); await save({ javaPath: info.path }); refresh(); renderSettingsPage(); }
  });
  $('sp-btn-java-auto').addEventListener('click', async () => {
    await save({ javaPath: '' }); toast('已恢复自动匹配 Java', true); refresh(); renderSettingsPage();
  });
  // 窗口
  $('sp-width').addEventListener('change', (e) => save({ width: Number(e.target.value) || 854 }));
  $('sp-height').addEventListener('change', (e) => save({ height: Number(e.target.value) || 480 }));
  $('sp-fullscreen').addEventListener('change', (e) => save({ fullscreen: e.target.checked }));
  // JVM / 隔离 / 服务器 / 镜像
  $('sp-jvmargs').addEventListener('change', (e) => save({ jvmArgs: e.target.value.trim() }));
  $('sp-isolation').addEventListener('change', (e) => save({ isolation: e.target.checked }));
  $('sp-server').addEventListener('change', (e) => save({ serverAddress: e.target.value.trim() }));
  $('sp-mirror').addEventListener('change', (e) => save({ mirror: e.target.checked }));
  // 主题色
  document.querySelectorAll('.set-swatch').forEach((btn) => {
    btn.onclick = async () => {
      applyAccent(btn.dataset.accent);
      await save({ accent: btn.dataset.accent });
      document.querySelectorAll('.set-swatch').forEach((b) => b.classList.toggle('active', b === btn));
      toast('主题强调色已更新', true);
    };
  });
  // 背景图片：选择 / 恢复默认
  $('sp-btn-pick-bg').addEventListener('click', async () => {
    const btn = $('sp-btn-pick-bg');
    btn.disabled = true; btn.textContent = '处理中…';
    try {
      const r = await api('theme:pickBackground');
      if (r && r.ok === false) { toast(r.error || '设置背景失败'); return; }
      if (r && r.canceled) return;
      Object.assign(state.settings.global, { background: r.background || '', backgroundName: r.backgroundName || '' });
      applyTheme(state.settings.global);
      $('sp-bg-name').textContent = bgDisplayName(state.settings.global);
      $('sp-bg-name').title = r.backgroundName || '';
      $('sp-btn-reset-bg').hidden = !r.background;
      toast('背景图片已更新', true);
    } finally { btn.disabled = false; btn.textContent = '更改背景…'; }
  });
  $('sp-btn-reset-bg').addEventListener('click', async () => {
    const r = await api('theme:resetBackground');
    if (r && r.ok === false) return toast(r.error || '恢复默认失败');
    Object.assign(state.settings.global, { background: '', backgroundName: '' });
    applyTheme(state.settings.global);
    $('sp-bg-name').textContent = '默认背景';
    $('sp-bg-name').title = '';
    $('sp-btn-reset-bg').hidden = true;
    toast('已恢复默认背景', true);
  });
  // 打开游戏目录（shell.openPath：直接调系统文件管理器，跨平台不拼 file:// URL）
  $('sp-btn-open-root').addEventListener('click', async () => {
    if (!state.gameRoot) return toast('尚未设置游戏目录');
    const r = await api('shell:openPath', state.gameRoot);
    if (r && r.ok === false) toast('打开文件夹失败：' + (r.error || '未知错误'));
  });
  // 更改游戏目录
  $('sp-btn-change-root').addEventListener('click', async () => {
    const dir = await api('dialog:pickGameRoot');
    if (!dir) return;
    const r = await api('launcher:setGameRoot', dir);
    if (!r || !r.ok) return toast('切换目录失败：' + ((r && r.error) || '未知错误'));
    state = r.state || state;
    toast('游戏目录已切换，重启后旧数据可通过「迁移旧数据」搬入', true);
    renderSettingsPage();
  });
  // 迁移旧目录数据
  $('sp-btn-migrate-root').addEventListener('click', async () => {
    const r = await api('launcher:migrateGameRoot');
    if (!r || !r.ok) return toast('迁移失败：' + ((r && r.error) || '未知错误'));
    state = r.state || state;
    toast('旧数据已迁移到新游戏目录', true);
    await refresh();
  });
  // 检查更新（GitHub Releases）
  $('sp-btn-check-update').addEventListener('click', () => checkUpdate(true));
  // 打开账户管理
  $('sp-btn-open-account').addEventListener('click', () => openAccountModal());
}

/* ================= 检查更新 ================= */
const up = { checking: false, downloading: false, info: null };
function fmtUpdateNotes(md) {
  // Release 说明是 Markdown：转义后做最小渲染（标题/列表/链接/加粗/换行），够读且安全
  const lines = String(md || '').split(/\r?\n/);
  const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const inline = (s) => escHtml(s)
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="#" data-url="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
  const out = [];
  let inList = false;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^\s*[-*]\s+/.test(line)) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${inline(line.replace(/^\s*[-*]\s+/, ''))}</li>`);
      continue;
    }
    if (inList) { out.push('</ul>'); inList = false; }
    if (!line.trim()) continue;
    if (/^#{1,4}\s+/.test(line)) out.push(`<div class="un-h">${inline(line.replace(/^#{1,4}\s+/, ''))}</div>`);
    else out.push(`<p>${inline(line)}</p>`);
  }
  if (inList) out.push('</ul>');
  return out.join('') || '<p class="dim">该版本没有提供说明</p>';
}
async function checkUpdate(manual) {
  if (up.checking || up.downloading) return;
  up.checking = true;
  const btn = $('sp-btn-check-update');
  if (btn) { btn.disabled = true; btn.textContent = '检查中…'; }
  try {
    const r = await api('updater:check');
    if (!r || r.ok === false) { toast('检查更新失败：' + ((r && r.error) || '未知错误')); return; }
    up.info = r.info;
    if (!r.info.hasUpdate) {
      if (manual !== false) toast(`当前已是最新版本 v${r.info.current}`, true);
      return;
    }
    openUpdateModal(r.info);
  } catch (e) {
    toast('检查更新失败：' + ((e && e.message) || e));
  } finally {
    up.checking = false;
    if (btn) { btn.disabled = false; btn.textContent = '检查更新'; }
  }
}
function openUpdateModal(info) {
  up.info = info;
  $('um-cur').textContent = 'v' + (info.current);
  $('um-new').textContent = 'v' + info.latest;
  $('um-notes').innerHTML = fmtUpdateNotes(info.notes);
  // Release 说明里的链接：委托打开系统浏览器
  $('um-notes').onclick = (e) => {
    const a = e.target.closest('a[data-url]');
    if (a) { e.preventDefault(); api('shell:openExternal', a.dataset.url); }
  };
  const asset = $('um-asset');
  asset.textContent = info.asset ? `${info.asset.name} · ${fmtBytes(info.asset.size)}` : '未找到适用于本平台的安装包';
  const dlBtn = $('um-btn-download');
  dlBtn.disabled = !info.asset;
  dlBtn.textContent = info.asset ? '下载并安装' : '无可用安装包';
  $('um-progress').hidden = true;
  $('um-open').onclick = () => api('shell:openExternal', info.url);
  $('modal-update').hidden = false;
}
function bindUpdateModal() {
  $('um-btn-download').addEventListener('click', async () => {
    if (up.downloading) return;
    up.downloading = true;
    const btn = $('um-btn-download');
    btn.disabled = true; btn.textContent = '下载中 0%';
    $('um-progress').hidden = false;
    $('um-pfill').style.width = '0%';
    $('um-ptext').textContent = '正在连接…';
    try {
      const r = await api('updater:download');
      if (!r || !r.ok) {
        toast('下载失败：' + ((r && r.error) || '未知错误'));
        btn.textContent = '重试下载';
        return;
      }
      $('um-pfill').style.width = '100%';
      $('um-ptext').textContent = '下载完成，可以安装了';
      btn.textContent = '立即重启并安装';
      btn.disabled = false;
      btn.onclick = async () => {
        btn.disabled = true; btn.textContent = '正在重启…';
        const ar = await api('updater:apply');
        if (ar && ar.ok === false) { toast('安装失败：' + (ar.error || '未知错误')); btn.disabled = false; btn.textContent = '立即重启并安装'; }
        // ok：主进程会退出并交给平台脚本替换文件后重启
      };
    } catch (e) {
      toast('下载失败：' + ((e && e.message) || e));
      btn.textContent = '重试下载';
    } finally {
      up.downloading = false;
    }
  });
  onEvent('launcher://up-progress', (p) => {
    if ($('modal-update').hidden) return;
    if (p.stage === 'error') { $('um-ptext').textContent = p.message || '下载出错'; return; }
    $('um-pfill').style.width = (p.percent || 0) + '%';
    $('um-ptext').textContent = `${p.message || ''}${p.speed ? ' · ' + fmtSpeed(p.speed) : ''}`;
    const btn = $('um-btn-download');
    if (btn && up.downloading) btn.textContent = `下载中 ${p.percent || 0}%`;
  });
}

/* ================= 版本弹窗 ================= */
let verTab = 'installed';
let verSearch = '';
const LOADER_TABS = ['fabric', 'forge', 'neoforge', 'quilt'];
const LOADER_LABELS = { fabric: 'Fabric', forge: 'Forge', neoforge: 'NeoForge', quilt: 'Quilt' };
let loaderCatalogCache = null;
async function getLoaderCatalog() {
  if (!loaderCatalogCache) {
    const r = await api('versions:loaderCatalog');
    loaderCatalogCache = (r && r.ok && r.catalog) || {};
  }
  return loaderCatalogCache;
}
function openVersionModal() { $('modal-version').hidden = false; loadVerList(); }
function closeModal(id) { $(id).hidden = true; }

async function loadVerList() {
  if (!manifestCache) manifestCache = await api('versions:manifest');
  const installedIds = new Set(state.installed.map((v) => v.id));
  // 已安装的模组加载器版本反查其 MC 版本（主进程 listInstalled 已识别 loader / mc）
  const loaderInstalledMC = (loader) => new Set(
    state.installed.filter((v) => (v.loader || (v.fabric ? 'fabric' : null)) === loader && v.mc).map((v) => v.mc)
  );
  let list = [];
  if (verTab === 'installed') {
    list = state.installed.map((v) => ({ id: v.id, type: v.loader || (v.fabric ? 'fabric' : 'installed'), time: v.time, installed: true }));
  } else if (LOADER_TABS.includes(verTab)) {
    // 全量正式版列表（可搜索）；已装过该 loader 的版本直接标「已安装」，行上显示最新 loader 版本号
    const catalog = await getLoaderCatalog();
    const catMap = catalog[verTab] || {};
    const installedMC = loaderInstalledMC(verTab);
    list = manifestCache.versions
      .filter((v) => v.type === 'release')
      .slice(0, 400)
      .map((v) => ({ ...v, type: verTab, installed: installedMC.has(v.id), loaderVer: catMap[v.id] || '' }));
  } else if (verTab === 'old') {
    list = manifestCache.versions.filter((v) => v.type.startsWith('old_'));
  } else {
    list = manifestCache.versions.filter((v) => v.type === verTab);
  }
  if (verSearch) list = list.filter((v) => v.id.includes(verSearch));
  const box = $('ver-list');
  if (!list.length) { box.innerHTML = '<div class="ver-empty">没有匹配的版本</div>'; return; }
  box.innerHTML = '';
  for (const v of list) {
    const row = document.createElement('div');
    row.className = 'ver-row';
    const typeLabel = { release: '正式版', snapshot: '快照', old_beta: 'Beta', old_alpha: 'Alpha', fabric: 'Fabric', forge: 'Forge', neoforge: 'NeoForge', quilt: 'Quilt', installed: '已安装' }[v.type] || v.type;
    const inst = installedIds.has(v.id);
    const sel = state.settings.selectedVersionId === v.id;
    row.innerHTML =
      `<span class="vname">${v.id}</span>` +
      `<span class="vtype ${v.type}">${typeLabel}</span>` +
      `<span class="vmeta">${(v.releaseTime || v.time || '').slice(0, 10)}${v.loaderVer ? ` · ${LOADER_LABELS[v.type]} ${v.loaderVer}` : ''}${sel ? ' · <b style="color:#93c5fd">当前选择</b>' : ''}</span>` +
      `<span class="vstate">${inst ? '已装' : ''}</span>`;
    const btn = document.createElement('button');
    btn.className = 'btn';
    if (LOADER_TABS.includes(v.type)) {
      const label = LOADER_LABELS[v.type];
      if (v.installed) {
        btn.textContent = `已装 ${label}`;
        btn.disabled = true;
      } else {
        const installText = v.loaderVer ? `安装 ${label} ${v.loaderVer}` : `安装 ${label}`;
        btn.textContent = installText;
        btn.onclick = async () => {
          btn.disabled = true; btn.textContent = '安装中…';
          installing = { id: v.id, btn };
          const r = v.type === 'fabric'
            ? await api('versions:installFabric', v.id)
            : await api('versions:installLoader', { loader: v.type, mc: v.id });
          installing = null;
          if (r.ok) { toast(`${v.id} ${label} 安装完成`, true); await refresh(); loadVerList(); }
          else { toast(r.error); btn.disabled = false; btn.textContent = installText; }
        };
      }
    } else if (inst) {
      btn.textContent = '选择';
      btn.onclick = async () => { await api('versions:select', v.id); closeModal('modal-version'); await refresh(); };
    } else {
      btn.textContent = '安装';
      btn.onclick = async () => {
        btn.disabled = true; btn.textContent = '0%';
        installing = { id: v.id, btn };
        const r = await api('versions:install', v.id);
        installing = null;
        if (r.ok) { toast(`${v.id} 安装完成`, true); await api('versions:select', v.id); closeModal('modal-version'); await refresh(); }
        else { toast(r.error); btn.disabled = false; btn.textContent = '安装'; }
      };
    }
    row.appendChild(btn);
    box.appendChild(row);
  }
}

/* ================= 账户弹窗 ================= */
function openAccountModal() {
  $('modal-account').hidden = false;
  renderAccountList();
}
function renderAccountList() {
  const wrap = $('account-list-wrap');
  const list = $('account-list');
  if (!state.accounts.length) { wrap.hidden = true; return; }
  wrap.hidden = false;
  list.innerHTML = '';
  for (const a of state.accounts) {
    const row = document.createElement('div');
    row.className = 'acc-row' + (state.selectedAccount && state.selectedAccount.id === a.id ? ' sel' : '');
    row.innerHTML = `<span class="aname">${a.name}</span><span class="atype">${a.type === 'yggdrasil' ? 'LittleSkin' : a.type === 'microsoft' ? '微软正版' : '离线'} · ${a.uuid.slice(0, 8)}…</span>`;
    const acts = document.createElement('div');
    acts.className = 'arow-actions';
    if (!(state.selectedAccount && state.selectedAccount.id === a.id)) {
      const sel = document.createElement('button');
      sel.className = 'btn-ghost btn-sm'; sel.textContent = '切换';
      sel.onclick = async () => { await api('account:select', a.id); await refresh(); renderAccountList(); };
      acts.appendChild(sel);
    }
    const del = document.createElement('button');
    del.className = 'btn-ghost btn-sm'; del.textContent = '删除';
    del.onclick = async () => { await api('account:remove', a.id); await refresh(); renderAccountList(); };
    acts.appendChild(del);
    row.appendChild(acts);
    list.appendChild(row);
  }
}

/* ================= 启动流程 ================= */
function setLaunchButton(mode) {
  const btn = $('btn-launch'), txt = $('btn-launch-text'), prog = $('launch-progress');
  if (mode === 'running') { btn.classList.add('running'); btn.disabled = false; txt.textContent = '结束游戏'; prog.hidden = true; }
  else if (mode === 'installing') { btn.classList.remove('running'); btn.disabled = true; txt.textContent = '下载中…'; prog.hidden = false; }
  else if (mode === 'busy') { btn.classList.remove('running'); btn.disabled = true; txt.textContent = '启动中…'; prog.hidden = true; }
  else { btn.classList.remove('running'); btn.disabled = false; txt.textContent = '开始游戏'; prog.hidden = true; }
}
function appendLog(line) {
  const box = $('log-box');
  box.textContent += line + '\n';
  box.scrollTop = box.scrollHeight;
  logLines++;
  $('log-count').textContent = `(${logLines} 行)`;
  // 首条日志到达 = 游戏进程已真正拉起：按钮切到可中断的「结束游戏」
  if (!state.running && line) { state.running = true; setLaunchButton('running'); }
}

/* 防连点：从点击到游戏退出事件之间保持锁定，避免并发 launch / 假死 */
let launching = false;
async function onLaunchClick() {
  if (launching) return;
  if (state.running) { await api('game:stop'); return; }
  if (!state.selectedAccount) { toast('请先登录账户'); openAccountModal(); return; }
  const vid = state.settings.selectedVersionId;
  if (!vid) { toast('请先选择版本'); openVersionModal(); return; }
  const installed = state.installed.some((v) => v.id === vid);
  launching = true;
  try {
    if (!installed) {
      setLaunchButton('installing');
      $('ip-text').textContent = '准备下载…';
      const ir = await api('versions:install', vid);
      if (!ir.ok) { toast('安装失败：' + ir.error); setLaunchButton('idle'); return; }
      await refresh();
    }
    setLaunchButton('busy');
    const r = await api('game:launch', vid);
    if (!r.ok) { toast('启动失败：' + r.error); setLaunchButton('idle'); return; }
    // 已受理：进程起来由日志事件切「结束游戏」，退出由 game-exit 复位
  } catch (e) {
    toast('启动失败：' + ((e && e.message) || e));
    setLaunchButton('idle');
  } finally {
    launching = false;
  }
}

/* ================= 进度事件 ================= */
function onProgress(p) {
  if (p.stage === 'error') { toast(p.message); setLaunchButton('idle'); if (installing && installing.btn) { installing.btn.disabled = false; installing.btn.textContent = '安装'; } installing = null; return; }
  const pct = p.percent || 0;
  $('lp-fill').style.width = pct + '%';
  $('lp-text').textContent = `${p.message || ''}${p.speed ? ' · ' + fmtSpeed(p.speed) : ''}`;
  if (installing && installing.btn) installing.btn.textContent = pct + '%';
  if (p.stage === 'done') { setTimeout(() => { if (!state.running) setLaunchButton('idle'); }, 800); installing = null; }
  // 版本卡片下方的安装进度
  const vid = state.settings.selectedVersionId;
  if (vid && !state.installed.some((v) => v.id === vid)) {
    $('install-progress').hidden = false;
    $('ip-fill').style.width = pct + '%';
    $('ip-text').textContent = p.message || '';
  } else {
    $('install-progress').hidden = true;
  }
}

/* ================= 页面渲染 ================= */
let refreshSeq = 0; // 并发守卫：快速切换版本/目录时会并发多次 getState，只认最后一次
async function refresh() {
  const seq = ++refreshSeq;
  state = await api('launcher:getState');
  if (seq !== refreshSeq) return; // 已有更新的刷新被触发，丢弃本次过期结果
  await renderAccountCard();
  if (seq !== refreshSeq) return;
  renderVersionCard();
  renderSettingsCard();
  setLaunchButton(state.running ? 'running' : 'idle');
  applyTheme(state.settings.global || {});
  if (currentPage === 'settings') renderSettingsPage();
}

/* ================= 事件绑定 ================= */
function bindUI() {
  // 窗口按钮
  $('win-min').onclick = () => api('window:minimize');
  $('win-max').onclick = () => api('window:maximize');
  $('win-close').onclick = () => api('window:close');

  // 导航
  const soonTitles = {}; // 所有页面均已实现，预留占位
  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.onclick = () => {
      const page = btn.dataset.page;
      currentPage = page;
      if (page !== 'game' && page !== 'download' && page !== 'settings' && page !== 'wiki') $('soon-title').textContent = `${soonTitles[page] || page}在等你的设计图`;
      document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.page').forEach((p) => p.classList.toggle('active', p.id === 'page-' + page));
      if (page === 'download' && !dl.loaded) dlLoadList();
      if (page === 'settings') renderSettingsPage();
      if (page === 'wiki') wikiOpen();
    };
  });
  $('btn-back-game').onclick = () => document.querySelector('.nav-item[data-page="game"]').click();

  // 弹窗
  $('btn-switch-version').onclick = openVersionModal;
  $('btn-account').onclick = openAccountModal;
  $('card-vsettings').onclick = () => openVSettingsModal();
  $('btn-vsettings-save').onclick = async () => {
    const vid = state.settings.selectedVersionId;
    const patch = {
      memory: Number($('set-memory').value) * 1024,
      width: Number($('set-width').value),
      height: Number($('set-height').value),
      fullscreen: $('set-fullscreen').checked,
      jvmArgs: $('set-jvmargs').value,
      isolation: $('set-isolation').checked,
    };
    if (vid) await api('settings:save', { perVersion: { [vid]: patch } });
    else await api('settings:save', { global: patch });
    closeModal('modal-vsettings');
    await refresh();
    toast('版本设置已保存', true);
  };
  document.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => closeModal(b.dataset.close)));
  document.querySelectorAll('.modal-mask').forEach((m) => (m.onclick = (e) => { if (e.target === m) m.hidden = true; }));
  document.querySelectorAll('.mtab[data-tab]').forEach((t) => (t.onclick = () => {
    document.querySelectorAll('.mtab[data-tab]').forEach((x) => x.classList.toggle('active', x === t));
    verTab = t.dataset.tab; loadVerList();
  }));
  document.querySelectorAll('.mtab[data-atab]').forEach((t) => (t.onclick = () => {
    document.querySelectorAll('.mtab[data-atab]').forEach((x) => x.classList.toggle('active', x === t));
    ['offline', 'littleskin', 'microsoft'].forEach((k) => ($(`atab-${k}`).hidden = t.dataset.atab !== k));
  }));
  $('ver-search').addEventListener('input', (e) => { verSearch = e.target.value.trim(); loadVerList(); });

  // 账户登录
  $('btn-offline-login').onclick = async () => {
    const name = $('offline-name').value.trim();
    if (!name) return toast('请输入玩家名');
    try { await api('account:loginOffline', name); } catch (e) { return toast('登录失败：' + e.message); }
    try { await refresh(); renderAccountList(); toast('离线账户已登录', true); }
    catch (e) { toast('登录成功，但界面刷新出错：' + (e && e.message || e)); }
  };
  $('btn-ys-login').onclick = async () => {
    const apiRoot = $('ys-api').value.trim(), username = $('ys-user').value.trim(), password = $('ys-pass').value;
    if (!apiRoot || !username || !password) return toast('请填写完整的皮肤站地址、用户名与密码');
    // 登录与界面刷新分开捕获：账户入库成功后，刷新异常不应误报「登录失败」
    try { await api('account:loginYggdrasil', { apiRoot, username, password }); }
    catch (e) { return toast('登录失败：' + e.message); }
    try { await refresh(); renderAccountList(); toast('LittleSkin 登录成功', true); }
    catch (e) { toast('登录成功，但界面刷新出错：' + (e && e.message || e)); }
  };

  // 微软正版登录（设备码流）
  $('btn-ms-login').onclick = async () => {
    const btn = $('btn-ms-login');
    btn.disabled = true; btn.textContent = '等待授权…';
    $('ms-device').hidden = false;
    $('ms-code').textContent = '······';
    $('ms-status').textContent = '正在获取设备码…';
    const r = await api('account:loginMicrosoft');
    if (r.ok) {
      $('ms-status').textContent = '登录成功';
      await refresh(); renderAccountList();
      toast(`微软账号 ${r.account.name} 登录成功`, true);
      $('ms-device').hidden = true;
    } else {
      $('ms-status').textContent = '登录失败：' + r.error;
      toast('微软登录失败：' + r.error);
    }
    btn.disabled = false; btn.textContent = '登录微软账号';
  };
  $('btn-ms-open').onclick = () => api('shell:openExternal', 'https://www.microsoft.com/link');
  onEvent('launcher://ms-code', (p) => {
    $('ms-device').hidden = false;
    $('ms-code').textContent = p.userCode;
    $('ms-status').textContent = '等待授权…（在浏览器输入代码完成登录）';
    if (p.verificationUri) $('btn-ms-open').onclick = () => api('shell:openExternal', p.verificationUri);
  });

  // 启动
  $('btn-launch').onclick = onLaunchClick;

  // 事件订阅
  onEvent('launcher://progress', onProgress);
  onEvent('launcher://dl-progress', onDlProgress);
  onEvent('launcher://game-log', appendLog);
  onEvent('launcher://game-exit', (p) => {
    state.running = false;
    if (p && p.error) toast('游戏异常退出：' + p.error);
    else if (p && p.code === 0) toast('游戏已退出', true);
    else if (p && p.code != null) toast(`游戏已退出（代码 ${p.code}）`);
    else toast('游戏已退出');
    setLaunchButton('idle');
  });
  // 启动时静默检查更新发现有新版 → 提示去设置页查看
  onEvent('launcher://up-available', (p) => {
    if (p && p.latest) toast(`发现新版本 v${p.latest}（当前 v${p.current || ''}），可在「设置 → 启动器」中更新`, false);
  });
}

/* ================= 下载页 ================= */
const DL_MC_VERSIONS = [
  '1.21.4', '1.21.1', '1.21', '1.20.6', '1.20.4', '1.20.1', '1.20',
  '1.19.4', '1.19.2', '1.19', '1.18.2', '1.18.1', '1.17.1', '1.16.5',
  '1.15.2', '1.14.4', '1.13.2', '1.12.2', '1.11.2', '1.10.2', '1.9.4', '1.8.9', '1.7.10',
];
const DL_CAT_LABELS = { vanilla: '原版游戏', mod: 'Mod', modpack: '整合包', datapack: '数据包', resourcepack: '资源包', shader: '光影包' };
const dl = {
  category: 'vanilla', source: 'modrinth',
  query: '', mcVersion: '', loader: '',
  items: [], total: 0,
  activeId: null, hoverTimer: null,
  detail: null, selectedVersionId: null,
  installing: false, loaded: false,
};

const fmtCount = (n) => (n >= 1e4 ? (n / 1e4).toFixed(1).replace(/\.0$/, '') + ' 万' : String(n || 0));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function verCmp(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d; }
  return 0;
}
function mcVersionRange(detail) {
  const set = new Set();
  for (const v of (detail && detail.versions) || []) {
    for (const g of v.gameVersions || []) if (/^\d+\.\d+(\.\d+)?$/.test(g)) set.add(g);
  }
  if (!set.size) {
    // 快照 / 预览版等非语义化版本号：直接取首个版本标识
    const first = ((detail && detail.versions) || [])[0];
    const g = first && (first.gameVersions || [])[0];
    return g || '—';
  }
  const arr = [...set].sort(verCmp);
  return arr.length === 1 ? arr[0] : `${arr[0]} ~ ${arr[arr.length - 1]}`;
}
function fmtDate(d) { return d ? String(d).slice(0, 10) : '—'; }

/** 草方块 SVG（原版分类图标，避免字母占位） */
const CUBE_SVG = '<svg viewBox="0 0 24 24" width="22" height="22"><path fill="#8bc34a" d="M12 3 4 7.5 12 12l8-4.5L12 3Z"/><path fill="#689f38" d="M4 7.5 12 12v9L4 16.5v-9Z"/><path fill="#795548" d="M12 12v9l8-4.5v-9L12 12Z"/></svg>';

function dlIconHTML(item, cls, isVanilla) {
  if (isVanilla) return `<div class="${cls}">${CUBE_SVG}</div>`;
  const label = esc((item.title || '?').trim().charAt(0).toUpperCase());
  // 字母垫底；图片加载失败时自动移除，回退字母头像
  return item.icon
    ? `<div class="${cls}"><span class="dl-icon-fallback">${label}</span><img src="${esc(item.icon)}" alt="" loading="lazy" onerror="this.remove()" /></div>`
    : `<div class="${cls}">${label}</div>`;
}

/* ---------- 列表 ---------- */
let dlReqSeq = 0; // 请求序号守卫：URL 参数/快速切换会并发触发多次加载，只有最后一次请求的结果允许渲染
async function dlLoadList() {
  dl.loaded = true;
  const seq = ++dlReqSeq;
  const box = $('dl-items');
  box.innerHTML = '<div class="dl-empty">正在加载内容列表…</div>';
  $('dl-count').textContent = '加载中…';
  $('dl-source-note').textContent = dl.source === 'mirror' ? '镜像站：仅原版分类生效' : '';
  // 弯引号规范化：从别处复制的模组名常带 ’‘“”，直接搜 Modrinth 会搜偏
  const q = dl.query.replace(/[’‘]/g, "'").replace(/[“”]/g, '"');
  const r = await api('download:search', {
    category: dl.category, source: dl.source, query: q,
    page: 1, mcVersion: dl.mcVersion, loader: dl.loader,
  });
  if (seq !== dlReqSeq) return; // 已有更新的加载被触发，丢弃本次过期结果
  if (r && r.error) {
    box.innerHTML = `<div class="dl-empty">${esc(r.error)}</div>`;
    $('dl-count').textContent = '加载失败';
    return;
  }
  dl.items = r.items || [];
  dl.total = r.total || 0;
  $('dl-count').textContent = `${DL_CAT_LABELS[dl.category]} · 共 ${dl.total} 个结果`;
  if (!dl.items.length) {
    box.innerHTML = `<div class="dl-empty">没有找到匹配的内容<br />换个关键词，或取消筛选条件试试</div>`;
    return;
  }
  box.innerHTML = '';
  for (const item of dl.items) {
    const row = document.createElement('div');
    row.className = 'dl-item';
    row.dataset.id = item.id;
    row.innerHTML =
      dlIconHTML(item, 'dl-item-icon', dl.category === 'vanilla') +
      `<div class="dl-item-main"><div class="dl-item-title">${esc(item.title)}</div><div class="dl-item-sub">${esc(item.summary || '')}</div></div>` +
      `<div class="dl-item-side"><span class="dl-item-dl">${item.downloads ? fmtCount(item.downloads) + ' 下载' : ''}</span>` +
      (item.installed ? '<span class="dl-item-tag installed">已安装</span>' : '') + '</div>';
    row.addEventListener('mouseenter', () => {
      clearTimeout(dl.hoverTimer);
      dl.hoverTimer = setTimeout(() => dlShowDetail(item), 120);
    });
    row.addEventListener('mouseleave', () => clearTimeout(dl.hoverTimer));
    row.addEventListener('click', () => dlShowDetail(item));
    box.appendChild(row);
  }
}

/* ---------- 悬停详情（灰色面板） ---------- */
async function dlShowDetail(item) {
  dl.activeId = item.id;
  document.querySelectorAll('.dl-item').forEach((r) => r.classList.toggle('active', r.dataset.id === item.id));
  const body = $('dl-detail-body'), empty = $('dl-detail-empty');
  empty.hidden = true; body.hidden = false;
  body.innerHTML = '<div class="dl-empty">加载详情…</div>';
  dl.detail = null; dl.selectedVersionId = null;

  // 原版游戏：详情就地生成，无需请求
  if (dl.category === 'vanilla') {
    const entry = { id: item.id, number: item.id, name: item.id, date: item.updated, gameVersions: [item.id], loaders: [] };
    dl.detail = {
      id: item.id, source: dl.source, title: item.title, summary: item.summary,
      icon: '', author: 'Mojang', downloads: 0, url: '',
      gameVersions: [item.id], versions: [entry], latest: entry, oldest: entry,
      _vanilla: true,
    };
    dl.selectedVersionId = entry.id;
    dlRenderDetail();
    return;
  }

  const r = await api('download:detail', { source: item.source, id: item.id });
  if (dl.activeId !== item.id) return; // 悬停已移走
  if (r && r.error) { body.innerHTML = `<div class="dl-empty">${esc(r.error)}</div>`; return; }
  dl.detail = r;
  dl.selectedVersionId = r.latest ? r.latest.id : null;
  dlRenderDetail();
}

function dlRenderDetail() {
  const d = dl.detail;
  if (!d) return;
  const body = $('dl-detail-body');
  const isVanilla = !!d._vanilla;
  const versions = (d.versions || []).slice(0, 30);
  const range = mcVersionRange(d);
  const loaders = isVanilla ? '原版（Vanilla）' : (d.loaders && d.loaders.length ? d.loaders.join(' / ') : '—');
  const installed = isVanilla && dl.items.find((i) => i.id === d.id && i.installed);
  body.innerHTML =
    `<div class="dd-head">${dlIconHTML(d, 'dd-icon', isVanilla)}<div><div class="dd-title">${esc(d.title)}</div>` +
    `<div class="dd-author">${esc(d.author || '未知作者')}${d.downloads ? ' · ' + fmtCount(d.downloads) + ' 下载' : ''}</div></div></div>` +
    (d.summary ? `<div class="dd-summary">${esc(d.summary)}</div>` : '') +
    `<div class="dd-facts">` +
    `<div class="dd-fact"><span>最新版本</span><b>${esc((d.latest && d.latest.number) || '—')}</b></div>` +
    `<div class="dd-fact"><span>最老版本</span><b>${esc((d.oldest && d.oldest.number) || '—')}</b></div>` +
    `<div class="dd-fact"><span>支持 MC 版本</span><b>${esc(range)}</b></div>` +
    `<div class="dd-fact"><span>加载器</span><b>${esc(loaders)}</b></div>` +
    `</div>` +
    (versions.length > 1 ? `<div class="dd-versions-label">版本列表（${versions.length}）</div><div class="dd-versions" id="dd-versions">` +
      versions.map((v) =>
        `<div class="dd-version${v.id === dl.selectedVersionId ? ' sel' : ''}" data-vid="${esc(v.id)}">` +
        `<span class="vnum">${esc(v.number || v.name)}</span><span class="vdate">${fmtDate(v.date)}</span></div>`).join('') + `</div>` : '') +
    `<div class="dd-actions">` +
    (isVanilla
      ? `<button class="btn" id="dd-install" ${installed ? 'disabled' : ''}>${installed ? '已安装' : '安装该版本'}</button>`
      : `<button class="btn" id="dd-install">安装${dl.selectedVersionId ? '所选版本' : ''}</button>`) +
    `</div>` +
    (d.url ? `<div class="dd-open"><a href="#" id="dd-open-url">在 Modrinth 上查看 ↗</a></div>` : '');
  body.querySelectorAll('.dd-version').forEach((row) => (row.onclick = () => {
    dl.selectedVersionId = row.dataset.vid;
    body.querySelectorAll('.dd-version').forEach((x) => x.classList.toggle('sel', x === row));
    const btn = $('dd-install');
    if (btn && !isVanilla) btn.textContent = '安装所选版本';
  }));
  const installBtn = $('dd-install');
  if (installBtn) installBtn.onclick = () => dlInstall();
  const openUrl = $('dd-open-url');
  if (openUrl) openUrl.onclick = (e) => { e.preventDefault(); api('shell:openExternal', d.url); };
}

/* ---------- 安装 ---------- */
async function dlInstall() {
  const d = dl.detail;
  if (!d || dl.installing) return;
  const item = dl.items.find((i) => i.id === d.id) || d;
  let payload;
  if (dl.category === 'vanilla') {
    payload = { category: 'vanilla', source: dl.source, versionId: d.id };
  } else {
    const v = (d.versions || []).find((x) => x.id === dl.selectedVersionId) || d.latest;
    if (!v || !v.url) { toast('该版本没有可用的下载文件'); return; }
    payload = {
      source: d.source, category: dl.category, projectId: d.id, versionId: v.id,
      url: v.url, fileName: v.fileName, sha1: v.sha1,
    };
  }
  dl.installing = true;
  $('dl-status').hidden = false;
  $('dl-status-text').textContent = `准备安装 ${d.title}…`;
  const r = await api('download:install', payload);
  dl.installing = false;
  if (!r.ok) { toast('安装失败：' + r.error); $('dl-status').hidden = true; return; }
  toast(`${d.title} 安装完成`, true);
  $('dl-status-text').textContent = `${d.title} 安装完成`;
  setTimeout(() => ($('dl-status').hidden = true), 2500);
  if (r.result && r.result.fabricVersionId) {
    await api('versions:select', r.result.fabricVersionId);
    toast(`已自动切换到 ${r.result.fabricVersionId}`, true);
  }
  await refresh();
  dlLoadList();
}

/* ---------- 安装进度 ---------- */
function onDlProgress(p) {
  if (p.stage === 'error') { toast(p.message); $('dl-status').hidden = true; dl.installing = false; return; }
  $('dl-status').hidden = false;
  $('dl-status-fill').style.width = (p.percent || 0) + '%';
  $('dl-status-text').textContent = p.message || '';
}

/* ---------- 工具栏绑定 ---------- */
function bindDownloadUI() {
  // 分类
  document.querySelectorAll('.dl-cat').forEach((btn) => {
    btn.onclick = () => {
      document.querySelectorAll('.dl-cat').forEach((b) => b.classList.toggle('active', b === btn));
      dl.category = btn.dataset.cat;
      dl.activeId = null; dl.detail = null; dl.selectedVersionId = null;
      $('dl-detail-body').hidden = true;
      $('dl-detail-empty').hidden = false;
      // 加载器筛选仅对 Mod 有意义
      $('dl-loader').disabled = dl.category !== 'mod';
      dlLoadList();
    };
  });
  // 来源
  document.querySelectorAll('.src-btn').forEach((btn) => {
    btn.onclick = () => {
      document.querySelectorAll('.src-btn').forEach((b) => b.classList.toggle('active', b === btn));
      dl.source = btn.dataset.source;
      dlLoadList();
    };
  });
  // MC 版本下拉
  const sel = $('dl-mcver');
  for (const v of DL_MC_VERSIONS) {
    const o = document.createElement('option');
    o.value = v; o.textContent = v;
    sel.appendChild(o);
  }
  sel.onchange = () => { dl.mcVersion = sel.value; dlLoadList(); };
  $('dl-loader').onchange = (e) => { dl.loader = e.target.value; dlLoadList(); };
  // 搜索（防抖）
  let timer = null;
  $('dl-query').addEventListener('input', (e) => {
    dl.query = e.target.value.trim();
    clearTimeout(timer);
    timer = setTimeout(dlLoadList, 350);
  });
  $('dl-query').addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(timer); dlLoadList(); } });
  $('dl-search-btn').onclick = dlLoadList;
  // 导入本地文件（补 Modrinth 没有的内容：CurseForge 独占模组 / 整合包等）
  $('dl-import').onclick = async () => {
    if (dl.category === 'vanilla') { toast('原版游戏请从列表中安装，不支持导入', false); return; }
    const r = await api('content:importFile', { category: dl.category });
    if (!r || r.canceled) return;
    await afterContentImport(r, dl.category);
  };
}

/* 本地导入完成后的统一收尾（按钮导入 / 拖拽导入共用） */
async function afterContentImport(r, category) {
  if (!r.ok) { toast('导入失败：' + (r.error || '未知错误'), false); return; }
  if (r.installed) {
    // 整合包：安装完成后自动切换到其 Fabric 版本
    if (r.result && r.result.fabricVersionId) {
      await api('versions:select', r.result.fabricVersionId);
      await refresh();
      toast(`整合包安装完成，已切换到 ${r.result.fabricVersionId}`, true);
    } else {
      await refresh();
      toast('整合包安装完成', true);
    }
    if (dl.loaded) dlLoadList();
  } else {
    const label = DL_CAT_LABELS[category] || '内容';
    const where = state.settings.selectedVersionId ? `当前版本（${state.settings.selectedVersionId}）` : '游戏根目录';
    toast(`已导入${label}「${r.name}」到${where}`, true);
  }
}

/* ================= 拖拽导入（PCL 式：拖文件到窗口即加载） ================= */
const dropZipQueue = []; // 待选择类型的 zip 队列

function droppedFilePath(file) {
  if (window.cube && window.cube.getPathForFile) {
    const p = window.cube.getPathForFile(file);
    if (p) return p;
  }
  return file.name; // 浏览器预览模式：用文件名占位
}

function initDragDrop() {
  const overlay = $('drop-overlay');
  let depth = 0;
  const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault(); depth++; overlay.hidden = false;
  });
  window.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'copy';
  });
  window.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault(); depth = Math.max(0, depth - 1);
    if (!depth) overlay.hidden = true;
  });
  window.addEventListener('drop', async (e) => {
    e.preventDefault(); overlay.hidden = true; depth = 0;
    const files = [...(e.dataTransfer ? e.dataTransfer.files : [])];
    if (files.length) await handleDroppedFiles(files);
  });
}

async function handleDroppedFiles(files) {
  const jars = [], zips = [], others = [];
  for (const f of files) {
    const n = f.name.toLowerCase();
    if (n.endsWith('.jar')) jars.push(f);
    else if (n.endsWith('.zip') || n.endsWith('.mrpack')) zips.push(f);
    else others.push(f);
  }
  if (others.length) {
    toast(`不支持的格式：${others.map((f) => f.name).join('、')}（仅支持 .jar / .zip / .mrpack）`, false);
  }
  if (!state.settings.selectedVersionId && jars.length) {
    toast('尚未选择版本，Mod 将装入游戏根目录', false);
  }
  // jar → Mod 直接导入
  for (const f of jars) {
    const r = await api('content:importPath', { category: 'mod', filePath: droppedFilePath(f) });
    await afterContentImport(r, 'mod');
  }
  // zip / mrpack → 弹类型选择，逐个处理
  if (zips.length) {
    dropZipQueue.length = 0;
    dropZipQueue.push(...zips.map(droppedFilePath));
    openDropTypeModal();
  }
}

function openDropTypeModal() {
  if (!dropZipQueue.length) { closeModal('modal-drop-type'); return; }
  const name = String(dropZipQueue[0]).split(/[\\/]/).pop();
  $('drop-type-file').textContent = name;
  $('modal-drop-type').hidden = false;
}

function bindDropTypeModal() {
  document.querySelectorAll('.drop-type-btn').forEach((btn) => {
    btn.onclick = async () => {
      const filePath = dropZipQueue.shift();
      if (!filePath) { closeModal('modal-drop-type'); return; }
      const r = await api('content:importPath', { category: btn.dataset.cat, filePath });
      await afterContentImport(r, btn.dataset.cat);
      openDropTypeModal(); // 处理队列中的下一个（无则自动关闭）
    };
  });
}

/* ================= Wiki 整合页 =================
 * 交互流：左侧紫搜索框过滤粉色版本列表 → 点列表项在右侧灰色区显示简略资料
 * → 点简略卡里的红色按钮进入详细视图 → 详细视图左上角返回键回到简略。
 * 数据来自版本清单 + 本机安装状态（wiki:versionInfo），可完全本地验证；
 * 百科正文通过外链按钮跳转系统浏览器（minecraft.wiki 有反爬，不站内抓取）。 */
const WIKI_TYPE_LABELS = { release: '正式版', snapshot: '快照', old_beta: 'Beta', old_alpha: 'Alpha', fabric: 'Fabric', installed: '已安装' };
const wiki = {
  tab: 'all',
  query: '',
  selectedId: null,
  view: 'brief', // 'brief' 简略 | 'detail' 详细
  detailCache: {},
};

function wikiInstalledSets() {
  const list = state && state.installed ? state.installed : [];
  return { ids: new Set(list.map((v) => v.id)), fab: new Set(list.filter((v) => v.fabric).map((v) => v.id)) };
}

async function wikiLoadManifest() {
  if (!manifestCache) manifestCache = await api('versions:manifest');
  return manifestCache;
}

function wikiFilteredList() {
  const { ids, fab } = wikiInstalledSets();
  const q = wiki.query.trim().toLowerCase();
  if (wiki.tab === 'installed') {
    let list = (state && state.installed ? state.installed : []).map((v) => ({ id: v.id, type: v.fabric ? 'fabric' : 'installed', releaseTime: v.time, installed: true, fabric: !!v.fabric }));
    if (q) list = list.filter((v) => v.id.toLowerCase().includes(q));
    return list;
  }
  const all = (manifestCache && manifestCache.versions) || [];
  let list = all.slice();
  if (wiki.tab === 'release') list = list.filter((v) => v.type === 'release');
  else if (wiki.tab === 'snapshot') list = list.filter((v) => v.type === 'snapshot');
  else if (wiki.tab === 'old') list = list.filter((v) => v.type.startsWith('old_'));
  if (q) {
    list = list.filter((v) => v.id.toLowerCase().includes(q));
    return list.slice(0, 100);
  }
  // 无搜索词时只渲染最近的版本，避免上千条 DOM
  return list.slice(0, 40).map((v) => ({ ...v, installed: ids.has(v.id), fabric: fab.has(v.id) }));
}

function renderWikiList() {
  const box = $('wiki-list');
  let list = wikiFilteredList();
  // 保证当前选中的版本始终可见（可能不在截断的前若干条内）
  if (wiki.selectedId && !list.some((v) => v.id === wiki.selectedId)) {
    const entry = wikiEntryOf(wiki.selectedId);
    const { ids, fab } = wikiInstalledSets();
    list = [{ ...entry, installed: ids.has(entry.id), fabric: fab.has(entry.id) }, ...list];
  }
  if (!list.length) {
    box.innerHTML = '<div class="wiki-empty-list">没有匹配的版本<br />换个关键词或选项卡试试</div>';
    return;
  }
  box.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (const v of list) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'wiki-item' + (v.id === wiki.selectedId ? ' active' : '');
    row.dataset.type = v.type;
    row.innerHTML =
      `<span class="wi-dot"></span><span class="wi-name" title="${v.id}">${v.id}</span>` +
      (v.installed ? '<span class="wi-installed">已装</span>' : '') +
      (v.fabric ? '<span class="wi-fab">Fabric</span>' : '');
    row.onclick = () => wikiShowBrief(v.id);
    frag.appendChild(row);
  }
  box.appendChild(frag);
}

function wikiEntryOf(id) {
  const inManifest = ((manifestCache && manifestCache.versions) || []).find((v) => v.id === id);
  if (inManifest) return inManifest;
  const inst = (state && state.installed ? state.installed : []).find((v) => v.id === id);
  return inst ? { id: inst.id, type: inst.fabric ? 'fabric' : 'installed', releaseTime: inst.time } : { id, type: 'release', releaseTime: '' };
}

function wikiSetView() {
  const has = !!wiki.selectedId;
  $('wiki-empty').hidden = has;
  $('wiki-brief').hidden = !(has && wiki.view === 'brief');
  $('wiki-detail').hidden = !(has && wiki.view === 'detail');
}

function wikiShowBrief(id) {
  wiki.selectedId = id;
  wiki.view = 'brief';
  const entry = wikiEntryOf(id);
  const { ids, fab } = wikiInstalledSets();
  const inst = ids.has(id);
  $('wb-version').textContent = id;
  const badge = $('wb-badge');
  badge.textContent = WIKI_TYPE_LABELS[entry.type] || entry.type;
  badge.dataset.type = entry.type;
  $('wb-facts').innerHTML =
    wikiFact('发布日期', (entry.releaseTime || entry.time || '—').slice(0, 10)) +
    wikiFact('版本类型', WIKI_TYPE_LABELS[entry.type] || entry.type) +
    wikiFact('安装状态', inst ? '已安装' : '未安装') +
    wikiFact('Fabric', !inst ? '—' : fab.has(id) ? '已安装' : '未安装');
  wikiSetView();
  renderWikiList();
  // 让选中项滚入可见区域
  const active = document.querySelector('.wiki-item.active');
  if (active) active.scrollIntoView({ block: 'nearest' });
}

const wikiFact = (label, value) => `<div class="wb-fact"><div class="wf-label">${label}</div><div class="wf-value">${value}</div></div>`;

async function wikiShowDetail(id) {
  wiki.selectedId = id;
  wiki.view = 'detail';
  wikiSetView();
  $('wd-title').textContent = `${id} · 详细资料`;
  $('wd-facts').innerHTML = '<div class="wd-fact"><span class="wf-label">状态</span><span class="wf-value">载入中…</span></div>';
  let info = wiki.detailCache[id];
  if (!info) {
    const r = await api('wiki:versionInfo', id);
    info = r && r.ok ? r.info : { error: (r && r.error) || '获取版本信息失败' };
    wiki.detailCache[id] = info;
  }
  // 期间用户可能已切走
  if (wiki.selectedId !== id || wiki.view !== 'detail') return;
  if (info.error) {
    $('wd-facts').innerHTML = `<div class="wd-fact"><span class="wf-label">出错了</span><span class="wf-value">${info.error}</span></div>`;
    return;
  }
  const entry = wikiEntryOf(id);
  const rows = [
    ['发布日期', (info.releaseTime || '—').slice(0, 10)],
    ['版本类型', WIKI_TYPE_LABELS[entry.type] || entry.type],
    ['安装状态', info.installed ? (info.fabric ? '已安装（Fabric）' : '已安装') : '未安装'],
    ['Java 版本', info.javaMajor ? `Java ${info.javaMajor}` : '—'],
    ['资源索引', info.assetIndex || '—'],
    ['主类', info.mainClass || '—'],
    ['客户端大小', info.jarSize ? fmtBytes(info.jarSize) : '—'],
    ['客户端 SHA1', info.clientSha1 ? info.clientSha1.slice(0, 16) + '…' : '—'],
    ['继承自', info.inheritsFrom || '—'],
  ];
  $('wd-facts').innerHTML = rows
    .map(([label, value]) => `<div class="wd-fact"><span class="wf-label">${label}</span><span class="wf-value">${value}</span></div>`)
    .join('');
  $('wiki-btn-open-text').textContent = `在 Minecraft Wiki 查看 ${id}`;
  $('wiki-btn-open').onclick = () => api('shell:openExternal', info.wikiUrl);
  wikiLoadNotes(id);
}

/* 官方更新日志：Mojang 源全文，页内直接渲染（主进程已做 HTML 白名单净化） */
async function wikiLoadNotes(id) {
  const box = $('wd-notes');
  if (!box) return;
  box.hidden = false;
  box.innerHTML = '<div class="wd-notes-loading">正在载入官方更新日志…</div>';
  const ck = 'notes:' + id;
  let notes = wiki.detailCache[ck];
  if (!notes) {
    try {
      const r = await api('wiki:patchNotes', id);
      notes = r && r.ok ? r.notes : { found: false };
    } catch { notes = { found: false }; }
    wiki.detailCache[ck] = notes;
  }
  if (wiki.selectedId !== id || wiki.view !== 'detail') return; // 加载期间已切走
  if (notes && notes.found) {
    box.innerHTML =
      `<div class="wd-notes-head">官方更新日志 · ${esc(notes.entry.title || id)}</div>` +
      (notes.entry.image ? `<img class="wd-notes-img" src="${esc(notes.entry.image)}" alt="" loading="lazy" onerror="this.remove()" />` : '') +
      `<div class="wiki-doc">${notes.entry.body || ''}</div>`;
  } else {
    // 官方源未收录（过老 / 预览版等）→ 收起正文区，保留外链兜底
    box.hidden = true;
    box.innerHTML = '';
  }
}

async function wikiOpen() {
  await wikiLoadManifest();
  renderWikiList();
  wikiSetView();
}

function bindWikiPage() {
  let timer = null;
  $('wiki-query').addEventListener('input', (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => { wiki.query = e.target.value.trim(); renderWikiList(); }, 160);
  });
  document.querySelectorAll('.wtab[data-wtab]').forEach((t) => (t.onclick = () => {
    document.querySelectorAll('.wtab[data-wtab]').forEach((x) => x.classList.toggle('active', x === t));
    wiki.tab = t.dataset.wtab;
    renderWikiList();
  }));
  $('wiki-btn-detail').onclick = () => { if (wiki.selectedId) wikiShowDetail(wiki.selectedId); };
  $('wiki-back').onclick = () => { wiki.view = 'brief'; wikiSetView(); };
}

/* ================= 入口 ================= */
bindUI();
bindSettings();
bindDownloadUI();
bindSettingsPage();
bindUpdateModal();
if (typeof bindAiPanel === 'function') bindAiPanel();
initDragDrop();
bindDropTypeModal();
bindWikiPage();
refresh();
if (typeof aiLoadConfig === 'function') aiLoadConfig();
/* 预览 / 截图用：?modal=version / ?modal=account / ?modal=vsettings / ?modal=update 直接打开弹窗（方便截图看效果）；
 * ?modal=account&mstab=microsoft&mslogin=1 可打开微软标签页并模拟设备码登录流程。
 * Electron 调试同样生效（CUBE_PAGE 组合参数直达页面） */
if (location.search.includes('modal=version')) setTimeout(openVersionModal, 350);
if (location.search.includes('modal=account')) setTimeout(() => {
  openAccountModal();
  const qs = new URLSearchParams(location.search);
  if (qs.get('mstab') === 'microsoft') {
    document.querySelector('.mtab[data-atab="microsoft"]').click();
    if (qs.get('mslogin')) setTimeout(() => $('btn-ms-login').click(), 300);
  }
}, 350);
if (location.search.includes('modal=vsettings')) setTimeout(openVSettingsModal, 350);
if (location.search.includes('modal=update')) setTimeout(() => checkUpdate(true), 500);
/* URL 参数（Electron 与浏览器预览均生效）：?page=download|settings|wiki 直接打开页面；dlcat=mod 切分类；dlhover=1 列表载入后自动悬停第一项展示灰色详情面板 */
(function () {
  const qs = new URLSearchParams(location.search);
  const page = qs.get('page');
  if (page !== 'download' && page !== 'settings' && page !== 'wiki') return;
  setTimeout(() => {
    const nav = document.querySelector(`.nav-item[data-page="${page}"]`);
    if (nav) nav.click();
    // 设置页：scat=game|launcher|account|about 切换左侧分类（截图 / 调试用）
    const scat = qs.get('scat');
    if (page === 'settings' && scat) {
      const railBtn = document.querySelector(`.set-rail-item[data-scat="${scat}"]`);
      if (railBtn) railBtn.click();
    }
    // Wiki 页：wtab=all|release|snapshot|old|installed 切选项卡；wikiv=1.20.1 选中版本（简略视图）；加 wikidetail=1 直接进详细视图
    if (page === 'wiki') {
      const wtab = qs.get('wtab');
      if (wtab) {
        const tabBtn = document.querySelector(`.wtab[data-wtab="${wtab}"]`);
        if (tabBtn) tabBtn.click();
      }
      const wikiv = qs.get('wikiv');
      if (wikiv) {
        const wait = setInterval(() => {
          if (manifestCache) {
            clearInterval(wait);
            if (qs.get('wikiq')) { wiki.query = qs.get('wikiq'); $('wiki-query').value = wiki.query; }
            wikiShowBrief(wikiv);
            if (qs.get('wikidetail')) wikiShowDetail(wikiv);
          }
        }, 200);
      } else if (qs.get('wikiq')) {
        wiki.query = qs.get('wikiq');
        $('wiki-query').value = wiki.query;
        renderWikiList();
      }
    }
    const src = qs.get('dlsrc');
    if (src) {
      const srcBtn = document.querySelector(`.src-btn[data-source="${src}"]`);
      if (srcBtn) srcBtn.click();
    }
    const cat = qs.get('dlcat');
    const openHover = () => {
      if (qs.get('dlhover')) {
        const timer = setInterval(() => {
          if (dl.loaded && dl.items.length) { clearInterval(timer); dlShowDetail(dl.items[0]); }
        }, 250);
      }
    };
    if (cat) {
      const catBtn = document.querySelector(`.dl-cat[data-cat="${cat}"]`);
      if (catBtn) catBtn.click();
      // 等分类列表载入后再悬停
      const wait = setInterval(() => { if (dl.loaded && dl.items.length) { clearInterval(wait); openHover(); } }, 250);
    } else {
      openHover();
    }
  }, 400);
})();

/* 预览 / 截图用：?drop=1 展示拖拽遮罩；?droptype=1 展示 zip 类型选择弹窗 */
(function () {
  const qs = new URLSearchParams(location.search);
  if (qs.get('drop')) $('drop-overlay').hidden = false;
  if (qs.get('droptype')) {
    $('drop-type-file').textContent = qs.get('droptype') === '1' ? '示例整合包.zip' : qs.get('droptype');
    $('modal-drop-type').hidden = false;
  }
})();

/* 全局错误兜底：渲染层任何未捕获异常都给出可见提示，
 * 避免「点了没反应」式的静默失败（如登录链路里的空引用） */
window.addEventListener('error', (e) => {
  const msg = (e && e.message) || '未知错误';
  if (/Cannot set properties of null|Cannot read properties of null/.test(msg)) {
    toast('界面出现异常：' + msg + '（可继续操作，欢迎反馈）');
  }
});
window.addEventListener('unhandledrejection', (e) => {
  const msg = (e && e.reason && e.reason.message) || String(e.reason || '未知错误');
  toast('操作未完成：' + msg);
});
