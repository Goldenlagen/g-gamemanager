'use strict';

const fs = require('fs');
const path = require('path');
const { listSubkeys, queryValue } = require('./registryHelper');
const { extractIconPng } = require('./iconExtractor');

// Battle.net ne fournit pas de format de métadonnées simple et stable à parser.
// On s'appuie donc sur les entrées "Programmes et fonctionnalités" de Windows
// dont l'éditeur est Blizzard Entertainment (Overwatch 2, Diablo IV, WoW, etc.).
const UNINSTALL_ROOTS = [
  'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
];

const IGNORED_EXE_PATTERNS = ['unins', 'setup', 'crashreporter', 'battle.net', 'agent', 'helper', 'vcredist'];

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

async function scanBattleNet() {
  const games = [];

  for (const root of UNINSTALL_ROOTS) {
    const ids = listSubkeys(root);

    for (const id of ids) {
      const keyPath = `${root}\\${id}`;
      const publisher = queryValue(keyPath, 'Publisher');
      if (!publisher || !publisher.toLowerCase().includes('blizzard')) continue;

      const displayName = queryValue(keyPath, 'DisplayName');
      const installLocation = queryValue(keyPath, 'InstallLocation');

      if (!displayName || !installLocation || !fs.existsSync(installLocation)) continue;
      if (displayName.toLowerCase().includes('battle.net')) continue;

      const exePath = findMainExecutable(installLocation);
      if (!exePath) continue;

      const iconPath = await extractIconPng(exePath);

      games.push({
        name: displayName,
        platform: 'battlenet',
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

module.exports = { scanBattleNet, findMainExecutable };
