'use strict';

/**
 * CurseForge 适配层。
 *
 * 走 MCIM（mod.mcimirror.top）镜像，不需要任何 API Key：
 *   api.curseforge.com/v1        -> mod.mcimirror.top/curseforge/v1
 *   edge.forgecdn.net/files/...  -> mod.mcimirror.top/files/...
 *   media.forgecdn.net/avatars/..-> mod.mcimirror.top/avatars/...
 *
 * 镜像站是公益服务，随时可能不可用，所以每次请求都带超时与降级：
 *   镜像失败 -> 官方 API（需要用户自备 key，没有 key 时给出明确提示）
 */

const CF_GAME_ID = 432;

// CurseForge 内容大类（classId）
const CF_SECTIONS = {
  mod: 6,
  modpack: 4471,
  resourcepack: 12,
  datapack: 5,
  shader: 4,
  world: 17,
};

// modLoaderType。0（Any）经实测会让 MCIM 返回空列表，所以「不限」时必须整个参数省略。
const CF_LOADERS = {
  forge: 1,
  quilt: 3,
  fabric: 4,
  neoforge: 5,
};

// MCIM 镜像里 Fabric / Forge / NeoForge / Quilt 的展示名
const CF_LOADER_NAMES = ['Fabric', 'Forge', 'NeoForge', 'Quilt'];

const CF_MIRROR_API = 'https://mod.mcimirror.top/curseforge/v1';
const CF_MIRROR_CDN = 'https://mod.mcimirror.top';
const CF_OFFICIAL_API = 'https://api.curseforge.com/v1';

const CF_UA = 'NCL/NexusCraftLauncher (+https://github.com/911q2w3e1q/ncl)';

// 官方 CDN 域名（已废弃的 edge 也留着，CF 仍在返回它）
const CF_CDN_HOSTS = ['edge.forgecdn.net', 'mediafilez.forgecdn.net', 'media.forgecdn.net'];

// 这些路径 MCIM 有缓存并代理；/attachments/ 没有代理，改写会 404。
const CF_CDN_PROXY_PATHS = ['/files/', '/avatars/'];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 把 CurseForge 的 CDN 地址改写成镜像地址。
 * 只改写 MCIM 确实代理的路径，其余保持原样。
 */
function rewriteCdnUrl(url) {
  const s = String(url || '');
  if (!s) return s;
  if (!CF_CDN_HOSTS.some((h) => s.includes(h))) return s;
  if (!CF_CDN_PROXY_PATHS.some((p) => s.includes(p))) return s;
  for (const host of CF_CDN_HOSTS) {
    if (s.includes(host)) return s.replace('https://' + host, CF_MIRROR_CDN);
  }
  return s;
}

/**
 * 从 CurseForge 的 hashes 数组里取指定算法的值。
 * CF 的枚举：1 = Sha1，2 = Md5。
 */
function pickHash(hashes, algo) {
  if (!Array.isArray(hashes)) return '';
  const hit = hashes.find((h) => Number(h && h.algo) === algo);
  return (hit && hit.value) || '';
}

/** 从文件的 gameVersions 里挑出真正的 MC 版本号（过滤掉 Client / Server / Fabric 这类标记） */
function pickGameVersion(file, mcVersion) {
  const gvs = Array.isArray(file && file.gameVersions) ? file.gameVersions : [];
  const real = gvs.filter((v) => /^\d+\.\d+(\.\d+)?$/.test(String(v)));
  if (mcVersion && real.includes(mcVersion)) return mcVersion;
  return real[0] || '';
}

/** 从文件里推断加载器 */
function pickLoaders(file) {
  const out = [];
  const gvs = Array.isArray(file && file.gameVersions) ? file.gameVersions : [];
  for (const name of CF_LOADER_NAMES) {
    if (gvs.includes(name)) out.push(name.toLowerCase());
  }
  return out;
}

/** CurseForge 的依赖关系类型：3 = Required（前置），2 = Optional，6 = Incompatible */
const CF_RELATION_REQUIRED = 3;

function cfFileToEntry(file, mcVersion) {
  const deps = Array.isArray(file && file.dependencies) ? file.dependencies : [];
  const required = deps
    .filter((d) => Number(d && d.relationType) === CF_RELATION_REQUIRED)
    .map((d) => ({ modId: d.modId, fileId: d.fileId }));
  return {
    id: String(file.id),
    number: '',
    name: file.displayName || file.fileName || '',
    date: file.fileDate || '',
    gameVersions: Array.isArray(file.gameVersions) ? file.gameVersions : [],
    loaders: pickLoaders(file),
    url: rewriteCdnUrl(file.downloadUrl || ''),
    fileName: file.fileName || '',
    sha1: pickHash(file.hashes, 1),
    size: file.fileLength || 0,
    versionType: file.releaseType || 1,
    _mcVersion: pickGameVersion(file, mcVersion),
    requiredDeps: required,
  };
}

/**
 * 统一的 CF 请求：先打镜像，失败再打官方（官方需要 key）。
 */
async function cfFetch(path, opts = {}) {
  const { apiKey = '', timeout = 30000, retries = 2 } = opts;
  const query = path.includes('?') ? path.slice(path.indexOf('?')) : '';
  const bare = path.split('?')[0];
  const targets = [{ base: CF_MIRROR_API, key: '' }];
  if (apiKey) targets.push({ base: CF_OFFICIAL_API, key: apiKey });

  let lastErr = null;
  for (const t of targets) {
    for (let i = 1; i <= retries; i++) {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), timeout);
      try {
        const headers = { 'User-Agent': CF_UA, Accept: 'application/json' };
        if (t.key) headers['x-api-key'] = t.key;
        const res = await fetch(t.base + bare + query, { headers, signal: ac.signal, redirect: 'follow' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        return { data: json, fromMirror: t.base === CF_MIRROR_API };
      } catch (e) {
        lastErr = e;
        if (i < retries) await sleep(400 * i);
      } finally {
        clearTimeout(timer);
      }
    }
  }
  const hint = apiKey
    ? 'CurseForge 镜像与官方接口均不可用'
    : 'CurseForge 镜像站暂时不可用（该镜像为公益服务），可稍后重试，或改用 Modrinth / 导入本地文件';
  throw new Error(`${hint}：${lastErr && lastErr.message ? lastErr.message : '未知错误'}`);
}

/**
 * 搜索内容。返回结构与 modrinthSearch 对齐，渲染层可以直接复用。
 */
async function searchMods(opts = {}) {
  const {
    category = 'mod', query = '', page = 1, mcVersion = '', loader = '',
    apiKey = '',
  } = opts;
  const classId = CF_SECTIONS[category];
  if (!classId) throw new Error(`CurseForge 不支持该分类：${category}`);

  const pageSize = 24;
  const params = new URLSearchParams();
  params.set('gameId', String(CF_GAME_ID));
  params.set('classId', String(classId));
  params.set('index', String((page - 1) * pageSize));
  params.set('pageSize', String(pageSize));
  if (query) params.set('searchFilter', query);
  if (mcVersion) params.set('gameVersion', mcVersion);
  // 「不限」时不能传 modLoaderType=0 —— 实测会让镜像返回空列表
  const loaderType = loader ? CF_LOADERS[String(loader).toLowerCase()] : 0;
  if (loaderType) params.set('modLoaderType', String(loaderType));
  params.set('sortField', 'popularity');

  const { data, fromMirror } = await cfFetch(`/mods/search?${params.toString()}`, { apiKey });
  const list = Array.isArray(data && data.data) ? data.data : [];
  const pagination = (data && data.pagination) || {};

  return {
    source: 'curseforge', category, page,
    total: Number(pagination.totalCount || list.length),
    mirrored: fromMirror,
    items: list.map((m) => ({
      id: String(m.id),
      source: 'curseforge',
      title: m.name || String(m.id),
      summary: m.summary || '',
      icon: rewriteCdnUrl((m.logo && m.logo.url) || ''),
      author: (m.authors && m.authors[0] && m.authors[0].name) || '',
      downloads: m.downloadCount || 0,
      tags: (m.categories || []).map((c) => c.slug || c.name).filter(Boolean),
      versions: [],
      updated: m.dateCreated || '',
      url: m.links && m.links.websiteUrl ? m.links.websiteUrl : '',
    })),
  };
}

/** 取单个项目的详情 + 可安装文件列表 */
async function getProject(modId, opts = {}) {
  const { mcVersion = '', loader = '', apiKey = '' } = opts;

  const { data: modRes } = await cfFetch(`/mods/${encodeURIComponent(modId)}`, { apiKey });
  const m = (modRes && modRes.data) || {};

  const params = new URLSearchParams();
  params.set('index', '0');
  params.set('pageSize', '100');
  if (mcVersion) params.set('gameVersion', mcVersion);
  const loaderType = loader ? CF_LOADERS[String(loader).toLowerCase()] : 0;
  if (loaderType) params.set('modLoaderType', String(loaderType));

  let files = [];
  try {
    const { data: fileRes } = await cfFetch(
      `/mods/${encodeURIComponent(modId)}/files?${params.toString()}`,
      { apiKey }
    );
    files = Array.isArray(fileRes && fileRes.data) ? fileRes.data : [];
  } catch {
    files = Array.isArray(m.latestFiles) ? m.latestFiles : [];
  }

  const entries = files.map((f) => cfFileToEntry(f, mcVersion));
  // CurseForge 的文件列表本身就是「最新在前」，再按时间排一次更稳
  const desc = [...entries].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  const latest = desc[0] || null;
  const oldest = desc[desc.length - 1] || null;

  // 汇总所有版本里出现过的前置依赖（去重）
  const depMap = new Map();
  for (const e of entries) {
    for (const d of e.requiredDeps || []) {
      const k = String(d.modId);
      if (!depMap.has(k)) depMap.set(k, { modId: d.modId, fileId: d.fileId });
    }
  }

  return {
    id: String(m.id || modId),
    source: 'curseforge',
    title: m.name || String(modId),
    summary: m.summary || '',
    icon: rewriteCdnUrl((m.logo && m.logo.url) || ''),
    author: (m.authors && m.authors[0] && m.authors[0].name) || '',
    downloads: m.downloadCount || 0,
    tags: (m.categories || []).map((c) => c.slug || c.name).filter(Boolean),
    url: (m.links && m.links.websiteUrl) || '',
    gameVersions: [],
    loaders: [],
    versions: entries,
    requiredDeps: [...depMap.values()],
    latest,
    oldest,
  };
}

/** 只取文件列表（整合包用得上：拿 latestFiles 的下载地址） */
async function getFiles(modId, opts = {}) {
  const { mcVersion = '', loader = '', apiKey = '' } = opts;
  const params = new URLSearchParams();
  params.set('index', '0');
  params.set('pageSize', '50');
  if (mcVersion) params.set('gameVersion', mcVersion);
  const loaderType = loader ? CF_LOADERS[String(loader).toLowerCase()] : 0;
  if (loaderType) params.set('modLoaderType', String(loaderType));
  const { data } = await cfFetch(
    `/mods/${encodeURIComponent(modId)}/files?${params.toString()}`,
    { apiKey }
  );
  return (Array.isArray(data && data.data) ? data.data : []).map((f) => cfFileToEntry(f, mcVersion));
}

/**
 * 整合包 manifest.json 里给的是 projectID + fileID，需要换成真实下载地址。
 */
async function getFileById(projectId, fileId, opts = {}) {
  const { apiKey = '' } = opts;
  const { data } = await cfFetch(
    `/mods/${encodeURIComponent(projectId)}/files/${encodeURIComponent(fileId)}`,
    { apiKey }
  );
  const f = (data && data.data) || null;
  if (!f) return null;
  return cfFileToEntry(f, '');
}

/**
 * 取某个项目当前版本适配的最新文件。
 * CurseForge 的 dependencies 里只有 modId、没有 fileId，所以依赖要先这样定位文件。
 */
async function getLatestFile(modId, opts = {}) {
  const { mcVersion = '', loader = '', apiKey = '' } = opts;
  const params = new URLSearchParams();
  params.set('index', '0');
  params.set('pageSize', '5');
  if (mcVersion) params.set('gameVersion', mcVersion);
  const loaderType = loader ? CF_LOADERS[String(loader).toLowerCase()] : 0;
  if (loaderType) params.set('modLoaderType', String(loaderType));
  const { data } = await cfFetch(
    `/mods/${encodeURIComponent(modId)}/files?${params.toString()}`,
    { apiKey }
  );
  const list = Array.isArray(data && data.data) ? data.data : [];
  if (!list.length) return null;
  return cfFileToEntry(list[0], mcVersion);
}

/**
 * 解析 CurseForge 整合包的 manifest.json（纯函数，便于测试）。
 */
function parseManifest(manifest) {
  const m = manifest || {};
  const mc = (m.minecraft && m.minecraft.version) || '';
  const loaderList = (m.minecraft && Array.isArray(m.minecraft.modLoaders) && m.minecraft.modLoaders) || [];
  const primary = loaderList.find((l) => l && l.primary) || loaderList[0] || null;
  let loaderType = '', loaderVer = '';
  if (primary && primary.id) {
    const mm = /^([a-z]+)-(.+)$/i.exec(String(primary.id));
    loaderType = mm ? mm[1].toLowerCase() : '';
    loaderVer = mm ? mm[2] : String(primary.id);
  }
  const files = Array.isArray(m.files) ? m.files.filter((f) => f && f.projectID && f.fileID) : [];
  return {
    mc,
    loaderType,
    loaderVer,
    files,
    overridesName: typeof m.overrides === 'string' && m.overrides ? m.overrides : 'overrides',
  };
}

module.exports = {
  CF_SECTIONS,
  CF_LOADERS,
  CF_MIRROR_API,
  CF_OFFICIAL_API,
  rewriteCdnUrl,
  pickHash,
  searchMods,
  getProject,
  getFiles,
  getFileById,
  getLatestFile,
  parseManifest,
};
