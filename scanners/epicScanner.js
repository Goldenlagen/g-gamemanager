'use strict';

const fs = require('fs');
const path = require('path');
const { extractIconPng } = require('./iconExtractor');

async function scanEpic() {
  const games = [];

  const manifestsDir = path.join(
    process.env.ProgramData || 'C:\\ProgramData',
    'Epic',
    'EpicGamesLauncher',
    'Data',
    'Manifests'
  );

  if (!fs.existsSync(manifestsDir)) return games;

  let files;
  try {
    files = fs.readdirSync(manifestsDir).filter((f) => f.toLowerCase().endsWith('.item'));
  } catch (e) {
    return games;
  }

  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(manifestsDir, file), 'utf8'));

      if (data.bIsIncompleteInstall) continue;

      const displayName = data.DisplayName;
      const installLocation = data.InstallLocation;
      const launchExecutable = data.LaunchExecutable;
      const catalogNamespace = data.CatalogNamespace;
      const catalogItemId = data.CatalogItemId;
      const appName = data.AppName;

      if (!displayName || !appName || !launchExecutable) continue;

      let iconPath = null;
      if (installLocation) {
        const fullExe = path.join(installLocation, launchExecutable);
        if (fs.existsSync(fullExe)) iconPath = await extractIconPng(fullExe);
      }

      const launchUri = `com.epicgames.launcher://apps/${catalogNamespace}%3A${catalogItemId}%3A${appName}?action=launch&silent=true`;

      games.push({
        name: displayName,
        platform: 'epic',
        iconPath,
        launchMode: 'uri',
        launchTarget: launchUri,
      });
    } catch (e) {
      // manifeste illisible, on passe au suivant
    }
  }

  return games;
}

module.exports = { scanEpic };
