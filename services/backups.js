'use strict';

// Sauvegardes de mondes Minecraft : archive zip des dossiers de monde dans un
// sous-dossier « gg-backups » du serveur. Zippage/dézippage via PowerShell
// (Compress-Archive / Expand-Archive), sans dépendance npm.

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

function backupsDir(serverPath) {
  return path.join(serverPath, 'gg-backups');
}

function listBackups(serverPath) {
  const dir = backupsDir(serverPath);
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith('.zip'))
      .map((f) => {
        const st = fs.statSync(path.join(dir, f));
        return { name: f, sizeBytes: st.size, mtimeMs: st.mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
  } catch (e) {
    return [];
  }
}

function psQuote(p) {
  return "'" + String(p).replace(/'/g, "''") + "'";
}

function runPowerShell(script, timeout = 300000) {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, timeout, maxBuffer: 1024 * 1024 * 8 },
      (err, stdout, stderr) => {
        if (err) resolve({ ok: false, error: ((stderr || err.message || '') + '').trim().slice(0, 300) });
        else resolve({ ok: true });
      }
    );
  });
}

/**
 * Crée une archive zip des dossiers de monde existants parmi `worldFolders`
 * (chemins relatifs au dossier du serveur).
 */
async function createBackup(serverPath, worldFolders) {
  const dir = backupsDir(serverPath);
  fs.mkdirSync(dir, { recursive: true });

  const existing = (worldFolders || [])
    .map((w) => path.join(serverPath, w))
    .filter((p) => fs.existsSync(p));
  if (existing.length === 0) return { ok: false, error: 'noWorld' };

  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const zipName = `backup_${ts}.zip`;
  const zipPath = path.join(dir, zipName);
  const paths = existing.map(psQuote).join(',');

  const script = `Compress-Archive -Path ${paths} -DestinationPath ${psQuote(zipPath)} -CompressionLevel Optimal -Force`;
  const res = await runPowerShell(script);
  if (!res.ok) {
    try { fs.rmSync(zipPath, { force: true }); } catch (e) { /* nettoyage best-effort */ }
    return { ok: false, error: res.error || 'zipFailed' };
  }
  return { ok: true, name: zipName };
}

/** Restaure une archive : réextrait les dossiers de monde dans le serveur (écrase). */
async function restoreBackup(serverPath, zipName) {
  const zipPath = path.join(backupsDir(serverPath), zipName);
  if (!fs.existsSync(zipPath)) return { ok: false, error: 'notFound' };

  const script = `Expand-Archive -Path ${psQuote(zipPath)} -DestinationPath ${psQuote(serverPath)} -Force`;
  const res = await runPowerShell(script);
  if (!res.ok) return { ok: false, error: res.error || 'unzipFailed' };
  return { ok: true };
}

function deleteBackup(serverPath, zipName) {
  try {
    fs.rmSync(path.join(backupsDir(serverPath), zipName), { force: true });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = { listBackups, createBackup, restoreBackup, deleteBackup, backupsDir };
