'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { app } = require('electron');

function getIconsDir() {
  const dir = path.join(app.getPath('userData'), 'icons');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function hashOf(str) {
  return crypto.createHash('sha1').update(str).digest('hex');
}

/**
 * Résout le chemin d'un fichier de ce dossier vers un emplacement réellement
 * lisible par un processus EXTERNE (powershell.exe, pas Node lui-même).
 *
 * Une fois l'appli empaquetée via electron-builder, `__dirname` pointe à
 * l'intérieur de `app.asar` — une archive virtuelle que seul Node/Electron
 * sait lire nativement (via `require`/`fs`). Un programme externe comme
 * PowerShell ne peut PAS ouvrir un fichier "à l'intérieur" de cette archive :
 * il faut donc rediriger vers son équivalent extrait sur disque, dans le
 * dossier `app.asar.unpacked` généré automatiquement par electron-builder
 * pour les fichiers listés en `asarUnpack` (voir package.json). Sans ce
 * correctif, l'erreur observée après packaging est un "chemin introuvable"
 * lorsque PowerShell tente d'exécuter ce script.
 */
function resolveExternalScriptPath(fileName) {
  const raw = path.join(__dirname, fileName);
  if (raw.includes(`${path.sep}app.asar${path.sep}`)) {
    return raw.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
  }
  return raw; // mode développement (pas d'asar) : chemin déjà correct tel quel
}

/**
 * Extrait l'icône "jumbo" (256x256) associée à un exécutable Windows via un
 * script PowerShell (API Shell IShellItemImageFactory, celle qu'utilise
 * l'Explorateur pour ses grandes icônes), la met en cache en PNG. Aucune
 * dépendance native npm nécessitant une compilation.
 */
function extractIconPng(exePath) {
  return new Promise((resolve) => {
    if (!exePath || !fs.existsSync(exePath)) return resolve(null);

    const outPath = path.join(getIconsDir(), hashOf(exePath) + '.png');
    if (fs.existsSync(outPath)) return resolve(outPath);

    const scriptPath = resolveExternalScriptPath('extract-icon.ps1');

    execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy', 'Bypass',
        '-WindowStyle', 'Hidden',
        '-File', scriptPath,
        '-ExePath', exePath,
        '-OutPath', outPath,
        '-Size', '256',
      ],
      { timeout: 8000, windowsHide: true },
      (err) => {
        if (!err && fs.existsSync(outPath)) resolve(outPath);
        else resolve(null);
      }
    );
  });
}

module.exports = { extractIconPng };
