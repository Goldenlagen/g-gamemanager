'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { app } = require('electron');
const { extractIconPng } = require('./iconExtractor');

function getConfigPath() {
  return path.join(app.getPath('userData'), 'manual_games.json');
}

function loadEntries() {
  try {
    const p = getConfigPath();
    if (!fs.existsSync(p)) return [];
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    return [];
  }
}

function saveEntries(entries) {
  const p = getConfigPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(entries, null, 2), 'utf8');
}

function addEntry(name, exePath) {
  const entries = loadEntries();
  entries.push({ name, exePath });
  saveEntries(entries);
}

function removeEntry(exePath) {
  const entries = loadEntries().filter((e) => e.exePath.toLowerCase() !== exePath.toLowerCase());
  saveEntries(entries);
}

async function scanManual() {
  const games = [];

  for (const entry of loadEntries()) {
    if (!entry.exePath || !fs.existsSync(entry.exePath)) continue;

    const iconPath = await extractIconPng(entry.exePath);

    games.push({
      name: entry.name,
      platform: 'manual',
      iconPath,
      launchMode: 'exe',
      launchTarget: entry.exePath,
      launchArgs: [],
      workingDirectory: path.dirname(entry.exePath),
    });
  }

  return games;
}

/**
 * Résout la cible d'un raccourci .lnk via l'objet COM WScript.Shell, disponible
 * nativement sur Windows sans dépendance npm supplémentaire.
 */
function resolveShortcut(lnkPath) {
  return new Promise((resolve) => {
    const esc = lnkPath.replace(/'/g, "''");
    const script = `$sh = New-Object -ComObject WScript.Shell; $sc = $sh.CreateShortcut('${esc}'); Write-Output $sc.TargetPath`;

    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script],
      { timeout: 5000, windowsHide: true },
      (err, stdout) => {
        if (err) return resolve(null);
        const target = (stdout || '').trim();
        resolve(target && fs.existsSync(target) ? target : null);
      }
    );
  });
}

module.exports = { loadEntries, saveEntries, addEntry, removeEntry, scanManual, resolveShortcut };
