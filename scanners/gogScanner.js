'use strict';

const fs = require('fs');
const path = require('path');
const { listSubkeys, queryValue } = require('./registryHelper');
const { extractIconPng } = require('./iconExtractor');

const ROOTS = ['HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games', 'HKLM\\SOFTWARE\\GOG.com\\Games'];

async function scanGog() {
  const games = [];

  for (const root of ROOTS) {
    const ids = listSubkeys(root);

    for (const id of ids) {
      const keyPath = `${root}\\${id}`;
      const name = queryValue(keyPath, 'gameName');
      const exe = queryValue(keyPath, 'exe');
      const installPath = queryValue(keyPath, 'path');

      if (!name || !exe) continue;

      let fullExe = exe;
      if (!path.isAbsolute(fullExe) && installPath) {
        fullExe = path.join(installPath, exe);
      }

      if (!fs.existsSync(fullExe)) continue;

      const iconPath = await extractIconPng(fullExe);

      games.push({
        name,
        platform: 'gog',
        iconPath,
        launchMode: 'exe',
        launchTarget: fullExe,
        launchArgs: [],
        workingDirectory: installPath || path.dirname(fullExe),
      });
    }
  }

  return games;
}

module.exports = { scanGog };
