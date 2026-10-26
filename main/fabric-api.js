/* Fabric API 一键安装
 *
 * 背景：Fabric 只是「加载器」，绝大多数 Fabric 模组还需要 Fabric API 这个依赖库
 * （Modrinth 项目 P7dR8mSH）。用户装完 Fabric 后还要自己去 Mod 页搜「Fabric API」
 * 再手动安装，体验断裂 —— 这里把它并进加载器安装流程，装完加载器顺手把 API 也装上。
 *
 * 流程：查 Modrinth 该 MC 版本对应的 fabric-api 版本 → 下载 primary jar → 放进 mods 目录
 */
'use strict';

const path = require('path');
const fs = require('fs');

const MODRINTH_API = 'https://api.modrinth.com/v2';
const FABRIC_API_PROJECT = 'P7dR8mSH';

/** 拿到某 MC 版本下可用的 fabric-api 版本列表（新→旧） */
async function listFabricApiVersions(mcVersion, fetchJSON) {
  const enc = encodeURIComponent(JSON.stringify([mcVersion]));
  const list = await fetchJSON(
    `${MODRINTH_API}/project/${FABRIC_API_PROJECT}/version?game_versions=${enc}`,
  );
  return (Array.isArray(list) ? list : []).map((v) => ({
    id: v.id,
    versionNumber: v.version_number || v.name || '',
    date: v.date_published || '',
    files: (v.files || []).map((f) => ({
      url: f.url,
      name: f.filename,
      sha1: f.hashes && f.hashes.sha1,
      primary: !!f.primary,
      size: f.size,
    })),
  })).sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

/**
 * 安装 Fabric API 到指定游戏目录的 mods 目录
 *
 * @param {string} mcVersion 目标 MC 版本，如 26.1.2
 * @param {string} gameDir    游戏根目录（mods 目录的父目录）
 * @param {(p:object)=>void} onProgress 进度回调
 * @param {(url:string)=>Promise<any>} fetchJSON
 * @param {(url:string,dest:string,opts:object)=>Promise<void>} downloadFile
 * @returns {Promise<{path:string, version:string, skipped?:string}>}
 */
async function installFabricApi(mcVersion, gameDir, onProgress, fetchJSON, downloadFile) {
  const versions = await listFabricApiVersions(mcVersion, fetchJSON);
  if (!versions.length) {
    // 该 MC 版本还没出 fabric-api：不阻断加载器安装，只提示
    return { skipped: `Fabric API 暂未提供 ${mcVersion} 版本`, path: '', version: '' };
  }
  const v = versions[0];
  const file = v.files.find((f) => f.primary) || v.files[0];
  if (!file) return { skipped: 'Fabric API 没有可下载文件', path: '', version: v.versionNumber };

  const modsDir = path.join(gameDir, 'mods');
  fs.mkdirSync(modsDir, { recursive: true });
  const dest = path.join(modsDir, file.name || `fabric-api-${v.versionNumber}.jar`);

  onProgress({
    stage: 'fabric-api',
    message: `下载 Fabric API ${v.versionNumber}`,
    percent: 0,
    speed: 0,
  });
  await downloadFile(file.url, dest, {
    sha1: file.sha1 || undefined,
    onProgress: (p) => onProgress({
      stage: 'fabric-api',
      message: `下载 Fabric API ${v.versionNumber} ${p.percent || 0}%`,
      percent: p.total ? Math.round((p.loaded / p.total) * 100) : 0,
      speed: p.speed,
    }),
  });
  return { path: dest, version: v.versionNumber };
}

module.exports = { installFabricApi, listFabricApiVersions, FABRIC_API_PROJECT };
