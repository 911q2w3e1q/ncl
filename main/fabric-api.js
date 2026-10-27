'use strict';

const path = require('path');
const fs = require('fs');

const MODRINTH_API = 'https://api.modrinth.com/v2';
const FABRIC_API_PROJECT = 'P7dR8mSH';

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

async function installFabricApi(mcVersion, gameDir, onProgress, fetchJSON, downloadFile) {
  const versions = await listFabricApiVersions(mcVersion, fetchJSON);
  if (!versions.length) {
    
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
