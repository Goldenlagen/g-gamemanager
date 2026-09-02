'use strict';

const { scanSteam } = require('./steamScanner');
const { scanEpic } = require('./epicScanner');
const { scanGog } = require('./gogScanner');
const { scanBattleNet } = require('./battlenetScanner');
const { scanRiot } = require('./riotScanner');
const { scanOrigin } = require('./originScanner');
const { scanUbisoft } = require('./ubisoftScanner');
const { scanMicrosoft } = require('./microsoftScanner');
const { scanStandalone } = require('./standaloneScanner');
const { scanManual } = require('./manualGames');
const { getSettings } = require('../services/appSettings');

// Ordre d'affichage des launchers dans la grille : les jeux sont désormais
// regroupés par plateforme (dans cet ordre), puis triés alphabétiquement au
// sein de chaque groupe, plutôt que mélangés en une seule liste alphabétique.
const PLATFORM_ORDER = [
  'steam', 'epic', 'gog', 'battlenet', 'origin', 'ubisoft', 'riot', 'microsoft', 'standalone', 'manual',
];

function platformRank(platform) {
  const idx = PLATFORM_ORDER.indexOf(platform);
  return idx === -1 ? PLATFORM_ORDER.length : idx;
}

async function safe(fn, label) {
  try {
    return await fn();
  } catch (e) {
    console.error(`Scanner "${label}" a échoué :`, e);
    return [];
  }
}

async function scanAllGames() {
  let standaloneEnabled = false;
  try {
    standaloneEnabled = getSettings().standaloneGameScanEnabled;
  } catch (e) {
    // pas grave si le réglage n'est pas lisible : on scanne juste sans le mode expérimental
  }

  const scanTasks = [
    safe(scanSteam, 'steam'),
    safe(scanEpic, 'epic'),
    safe(scanGog, 'gog'),
    safe(scanBattleNet, 'battlenet'),
    safe(scanRiot, 'riot'),
    safe(scanOrigin, 'origin'),
    safe(scanUbisoft, 'ubisoft'),
    safe(scanMicrosoft, 'microsoft'),
    safe(scanManual, 'manual'),
  ];

  if (standaloneEnabled) {
    scanTasks.push(safe(scanStandalone, 'standalone'));
  }

  const results = await Promise.all(scanTasks);

  const games = results.flat();
  games.sort((a, b) => {
    const rankDiff = platformRank(a.platform) - platformRank(b.platform);
    if (rankDiff !== 0) return rankDiff;
    return a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' });
  });
  return games;
}

module.exports = { scanAllGames, PLATFORM_ORDER };
