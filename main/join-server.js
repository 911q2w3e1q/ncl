'use strict';

// 联机「加入并启动」的服务器地址处理。
//
// 背景：早期版本把加入的地址写进 perVersion[版本].serverAddress 并落盘，
// 导致之后每次启动该版本都会自动去连那个地址——隧道/朋友一旦下线地址就失效，
// 游戏启动即报「没有找到该主机」，而设置页里又看不见这个值（设置页只显示 global）。
//
// 现在：加入是一次性的启动参数；持久的「自动进入服务器」只在
// 「设置 → 自动进入服务器」里配置（global），两处不再互相污染。

function normalizeAddress(v) {
  return String(v == null ? '' : v).trim();
}

// 解析本次启动要注入的服务器地址。
// vs 为 versionSettings() 合并后的版本设置（global + perVersion）。
// override 为 undefined 表示「没有一次性覆盖，沿用设置里的持久值」；
// override 为字符串（可为空串）表示「本次就用这个地址」，优先于持久值。
// 返回值总是带端口的 host:port 形式——quickPlay 的解析要求显式端口，
// 只给域名时游戏侧会解析失败，表现同样是「没有找到该主机」。
function resolveServerAddress(vs, override) {
  const raw = (override !== undefined && override !== null)
    ? normalizeAddress(override)
    : normalizeAddress(vs && vs.serverAddress);
  if (!raw) return '';
  const withPort = /:\d{1,5}$/.test(raw) ? raw : `${raw}:25565`;
  return withPort;
}

// 一次性迁移：清掉历史遗留的 perVersion[版本].serverAddress。
// 这类值只可能由早期「加入联机」写入，没有界面入口，清掉不影响用户主动配置。
// 返回是否发生过修改。
function purgeLegacyPerVersionServerAddress(settings) {
  let changed = false;
  const pv = settings && settings.perVersion;
  if (!pv || typeof pv !== 'object') return false;
  for (const vid of Object.keys(pv)) {
    const cfg = pv[vid];
    if (cfg && typeof cfg === 'object' && 'serverAddress' in cfg) {
      delete cfg.serverAddress;
      changed = true;
    }
  }
  return changed;
}

module.exports = {
  resolveServerAddress,
  purgeLegacyPerVersionServerAddress,
  normalizeAddress,
};
