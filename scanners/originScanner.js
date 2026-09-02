'use strict';

const fs = require('fs');
const path = require('path');
const { queryValue, listSubkeys } = require('./registryHelper');
const { extractIconPng } = require('./iconExtractor');

const IGNORED_EXE_PATTERNS = [
  'unins', 'setup', 'redist', 'vcredist', 'directx', 'crashreporter',
  'easyanticheat', 'battleye', 'origin', 'eadesktop', 'eabackgroundservice',
];

function findMainExecutable(installLocation) {
  try {
    const entries = fs.readdirSync(installLocation, { withFileTypes: true });
    let candidates = entries
      .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.exe'))
      .map((e) => path.join(installLocation, e.name));

    candidates = candidates.filter(
      (p) => !IGNORED_EXE_PATTERNS.some((ig) => path.basename(p).toLowerCase().includes(ig))
    );

    if (candidates.length === 0) return null;

    candidates.sort((a, b) => fs.statSync(b).size - fs.statSync(a).size);
    return candidates[0];
  } catch (e) {
    return null;
  }
}

function prettifyName(raw) {
  return raw.replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Méthode 1 (Origin "classique") : chaque jeu possède sa propre clé de registre
 * avec un chemin d'installation direct.
 */
function scanClassicRegistry() {
  const games = [];
  const roots = ['HKLM\\SOFTWARE\\WOW6432Node\\Origin Games', 'HKLM\\SOFTWARE\\Origin Games'];

  for (const root of roots) {
    const ids = listSubkeys(root);
    for (const id of ids) {
      const keyPath = `${root}\\${id}`;
      const installDir = queryValue(keyPath, 'Install Dir');
      if (!installDir || !fs.existsSync(installDir)) continue;

      games.push({ installDir, rawName: path.basename(installDir) });
    }
  }

  return games;
}

/**
 * Méthode 2 (manifestes .mfst) : utilisée par Origin/EA app pour le contenu plus
 * récent. Chaque jeu a un dossier dans LocalContent contenant un fichier .mfst
 * dont le contenu est une simple chaîne de requête (clé=valeur&clé=valeur...).
 */
function scanManifests() {
  const games = [];
  const localContentDir = path.join(process.env.ProgramData || 'C:\\ProgramData', 'Origin', 'LocalContent');
  if (!fs.existsSync(localContentDir)) return games;

  let gameFolders;
  try {
    gameFolders = fs.readdirSync(localContentDir, { withFileTypes: true }).filter((e) => e.isDirectory());
  } catch (e) {
    return games;
  }

  for (const folder of gameFolders) {
    const folderPath = path.join(localContentDir, folder.name);

    let mfstFiles;
    try {
      mfstFiles = fs.readdirSync(folderPath).filter((f) => f.toLowerCase().endsWith('.mfst'));
    } catch (e) {
      continue;
    }

    for (const mfst of mfstFiles) {
      try {
        const content = fs.readFileSync(path.join(folderPath, mfst), 'utf8').trim();
        const params = new URLSearchParams(content);
        const installPath = params.get('dipInstallPath') || params.get('installpath') || params.get('installPath');

        if (installPath && fs.existsSync(installPath)) {
          games.push({ installDir: installPath, rawName: folder.name });
        }
      } catch (e) {
        // manifeste illisible, on passe au suivant
      }
    }
  }

  return games;
}

async function scanOrigin() {
  const games = [];
  const seenInstallDirs = new Set();

  const detected = [...scanClassicRegistry(), ...scanManifests()];

  for (const entry of detected) {
    const key = entry.installDir.toLowerCase();
    if (seenInstallDirs.has(key)) continue;
    seenInstallDirs.add(key);

    const exePath = findMainExecutable(entry.installDir);
    if (!exePath) continue;

    const iconPath = await extractIconPng(exePath);

    games.push({
      name: prettifyName(entry.rawName),
      platform: 'origin',
      iconPath,
      launchMode: 'exe',
      launchTarget: exePath,
      launchArgs: [],
      workingDirectory: entry.installDir,
    });
  }

  return games;
}

module.exports = { scanOrigin, findMainExecutable, scanClassicRegistry, scanManifests, prettifyName };
