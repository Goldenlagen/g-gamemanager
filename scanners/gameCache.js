'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

function getCachePath() {
  return path.join(app.getPath('userData'), 'games_cache.json');
}

/**
 * Charge le cache s'il existe et a une forme valide. Retourne null sinon
 * (première utilisation, fichier corrompu, format inattendu...).
 */
function loadCache() {
  try {
    const p = getCachePath();
    if (!fs.existsSync(p)) return null;

    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!Array.isArray(data.games) || typeof data.lastSync !== 'number') return null;

    return data;
  } catch (e) {
    return null;
  }
}

function saveCache(games) {
  const p = getCachePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });

  const payload = { games, lastSync: Date.now() };
  fs.writeFileSync(p, JSON.stringify(payload, null, 2), 'utf8');

  return payload;
}

module.exports = { loadCache, saveCache, getCachePath };
