'use strict';

const fs = require('fs');
const path = require('path');
const { queryValue, listSubkeys } = require('./registryHelper');
const { extractIconPng } = require('./iconExtractor');

const UNINSTALL_ROOTS = [
  'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
];

// Éditeurs déjà couverts par un scanner dédié ailleurs : exclus ici pour éviter les doublons.
const KNOWN_PUBLISHER_KEYWORDS = [
  'valve', 'epic games', 'gog', 'blizzard', 'electronic arts', 'ubisoft', 'riot games',
];

// Mots-clés très majoritairement associés à des logiciels/composants système plutôt
// qu'à des jeux. Filtrage heuristique forcément imparfait : Windows ne fait aucune
// distinction fiable entre "jeu" et "logiciel" dans son registre de désinstallation.
const NON_GAME_KEYWORDS = [
  'redistributable', 'runtime', 'visual c++', '.net framework', '.net core', 'directx',
  'driver', 'update for', 'security update', 'service pack', 'codec', 'sdk', 'toolkit',
  'framework', 'antivirus', 'vpn', 'assistant', 'helper', 'agent', 'sync client',
  'backup', 'realtek', 'chipset', 'bios', 'firmware', 'browser', 'adobe', 'java(tm)',
  'python', 'node.js', 'git', 'docker', 'microsoft office', 'creative cloud',
  'launcher', 'uninstall',
];

const IGNORED_EXE_PATTERNS = ['unins', 'setup', 'redist', 'vcredist', 'directx', 'crashreporter'];

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

function looksLikeNonGame(displayName, publisher) {
  const haystack = `${displayName || ''} ${publisher || ''}`.toLowerCase();
  if (KNOWN_PUBLISHER_KEYWORDS.some((kw) => haystack.includes(kw))) return true;
  if (NON_GAME_KEYWORDS.some((kw) => haystack.includes(kw))) return true;
  return false;
}

/**
 * Scan best-effort des jeux installés sans passer par un launcher tiers connu
 * (Steam, Epic, GOG...), via les entrées du registre de désinstallation
 * Windows. Intrinsèquement bruyant : Windows n'a aucun moyen fiable de
 * distinguer un jeu d'un logiciel quelconque dans cette liste. Désactivé par
 * défaut (voir services/appSettings.js), à activer volontairement.
 */
async function scanStandalone() {
  const games = [];
  const seenInstallDirs = new Set();

  for (const root of UNINSTALL_ROOTS) {
    const ids = listSubkeys(root);
    for (const id of ids) {
      const keyPath = `${root}\\${id}`;
      const displayName = queryValue(keyPath, 'DisplayName');
      const publisher = queryValue(keyPath, 'Publisher');
      const installLocation = queryValue(keyPath, 'InstallLocation');

      if (!displayName || !installLocation || !fs.existsSync(installLocation)) continue;
      if (looksLikeNonGame(displayName, publisher)) continue;

      const dedupeKey = installLocation.toLowerCase();
      if (seenInstallDirs.has(dedupeKey)) continue;
      seenInstallDirs.add(dedupeKey);

      const exePath = findMainExecutable(installLocation);
      if (!exePath) continue;

      const iconPath = await extractIconPng(exePath);

      games.push({
        name: displayName,
        platform: 'standalone',
        iconPath,
        launchMode: 'exe',
        launchTarget: exePath,
        launchArgs: [],
        workingDirectory: installLocation,
      });
    }
  }

  return games;
}

module.exports = { scanStandalone, looksLikeNonGame, findMainExecutable };
