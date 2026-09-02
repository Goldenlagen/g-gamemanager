'use strict';

const fs = require('fs');
const path = require('path');
const { queryValue, listSubkeys } = require('./registryHelper');
const { extractIconPng } = require('./iconExtractor');

const IGNORED_EXE_PATTERNS = [
  'unins', 'setup', 'redist', 'vcredist', 'directx', 'crashreporter',
  'easyanticheat', 'battleye', 'ubisoftgamelauncher', 'upc',
];

const ROOT = 'HKLM\\SOFTWARE\\WOW6432Node\\Ubisoft\\Launcher\\Installs';

/**
 * Recherche l'exécutable principal sur 2 niveaux de profondeur : beaucoup de
 * jeux Ubisoft rangent leur .exe dans un sous-dossier ("bin", "Game", etc.)
 * plutôt qu'à la racine du dossier d'installation.
 */
function findMainExecutable(installLocation) {
  const candidates = [];

  function collect(dir, depth) {
    let items;
    try {
      items = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      return;
    }
    for (const item of items) {
      const full = path.join(dir, item.name);
      if (item.isFile() && item.name.toLowerCase().endsWith('.exe')) {
        candidates.push(full);
      } else if (item.isDirectory() && depth < 2) {
        collect(full, depth + 1);
      }
    }
  }

  collect(installLocation, 0);

  const filtered = candidates.filter(
    (p) => !IGNORED_EXE_PATTERNS.some((ig) => path.basename(p).toLowerCase().includes(ig))
  );

  if (filtered.length === 0) return null;

  filtered.sort((a, b) => fs.statSync(b).size - fs.statSync(a).size);
  return filtered[0];
}

function prettifyName(raw) {
  return raw.replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

const ARTWORK_EXTENSIONS = /\.(jpg|jpeg|png|webp)$/i;
const ARTWORK_NAME_HINTS = /cover|boxart|box-art|logo|wide|tall|background|keyart|key-art|thumbnail|poster/i;

/**
 * Cherche une jaquette/logo déjà mise en cache localement par l'application
 * Ubisoft Connect elle-même pour ce jeu (identifié par son ID numérique, le
 * même que la clé de registre). Structure de cache best-effort : Ubisoft ne
 * documente pas ce format, qui peut varier selon les versions du launcher.
 */
function findUbisoftAppCacheImage(gameId) {
  const programData = process.env.ProgramData || 'C:\\ProgramData';
  const localAppData = process.env.LocalAppData || '';

  const candidateDirs = [
    path.join(programData, 'Ubisoft', 'Ubisoft Game Launcher', 'cache', 'assets', gameId),
    path.join(localAppData, 'Ubisoft Game Launcher', 'cache', 'assets', gameId),
    path.join(programData, 'Ubisoft', 'Ubisoft Game Launcher', 'data', gameId),
  ];

  for (const dir of candidateDirs) {
    if (!fs.existsSync(dir)) continue;

    let files;
    try {
      files = fs.readdirSync(dir);
    } catch (e) {
      continue;
    }

    const imageFiles = files.filter((f) => ARTWORK_EXTENSIONS.test(f));
    if (imageFiles.length === 0) continue;

    const preferred = imageFiles.find((f) => ARTWORK_NAME_HINTS.test(f)) || imageFiles[0];
    return path.join(dir, preferred);
  }

  return null;
}

/** Cherche une image promotionnelle (jaquette, logo...) directement dans le dossier d'installation du jeu. */
function findGameFileArtwork(installDir) {
  let files;
  try {
    files = fs.readdirSync(installDir);
  } catch (e) {
    return null;
  }

  const candidates = files.filter((f) => ARTWORK_EXTENSIONS.test(f) && ARTWORK_NAME_HINTS.test(f));
  if (candidates.length === 0) return null;

  return path.join(installDir, candidates[0]);
}

async function scanUbisoft() {
  const games = [];
  const ids = listSubkeys(ROOT);

  for (const id of ids) {
    const keyPath = `${ROOT}\\${id}`;
    const installDir = queryValue(keyPath, 'InstallDir');
    if (!installDir || !fs.existsSync(installDir)) continue;

    const exePath = findMainExecutable(installDir);
    if (!exePath) continue;

    // Priorité : image déjà mise en cache par l'application Ubisoft Connect,
    // puis une image trouvée directement dans les fichiers du jeu, et
    // seulement en dernier recours l'icône extraite de l'exécutable.
    let iconPath = findUbisoftAppCacheImage(id) || findGameFileArtwork(installDir);
    if (!iconPath) iconPath = await extractIconPng(exePath);

    // Ubisoft Connect ne stocke le nom des jeux que sous forme d'ID numérique
    // (nécessiterait une consultation du catalogue Ubisoft en ligne pour le nom
    // exact) : on utilise donc le nom du dossier d'installation, généralement
    // déjà lisible (ex: "Assassins Creed Valhalla").
    const displayName = prettifyName(path.basename(installDir));

    games.push({
      name: displayName,
      platform: 'ubisoft',
      iconPath,
      launchMode: 'exe',
      launchTarget: exePath,
      launchArgs: [],
      workingDirectory: installDir,
    });
  }

  return games;
}

module.exports = { scanUbisoft, findMainExecutable, prettifyName, findUbisoftAppCacheImage, findGameFileArtwork };
