'use strict';

// SteamGridDB : récupère de belles jaquettes verticales pour les jeux (utile
// pour les jeux qui n'ont qu'un petit logo — Epic, Riot/LoL, jeux ajoutés
// manuellement…). L'image est TÉLÉCHARGÉE en local (userData/artwork) puis
// référencée en file:// — ça évite tout souci de CSP et fournit un cache.
//
// La surcharge de jaquette par jeu est mémorisée dans game_artwork.json et
// appliquée au scan (voir main.js). Nécessite une clé API SteamGridDB
// (gratuite) renseignée dans les Réglages.

const fs = require('fs');
const path = require('path');
const https = require('https');
const { app } = require('electron');
const { pathToFileURL } = require('url');
const appSettings = require('./appSettings');

function overridesPath() {
  return path.join(app.getPath('userData'), 'game_artwork.json');
}

function getOverrides() {
  try {
    if (fs.existsSync(overridesPath())) {
      const data = JSON.parse(fs.readFileSync(overridesPath(), 'utf8'));
      return data && typeof data === 'object' ? data : {};
    }
  } catch (e) { /* ignore */ }
  return {};
}

function saveOverrides(obj) {
  try {
    fs.writeFileSync(overridesPath(), JSON.stringify(obj, null, 2), 'utf8');
  } catch (e) { /* ignore */ }
}

function setOverride(key, url) {
  const o = getOverrides();
  o[key] = url;
  saveOverrides(o);
}

function clearOverride(key) {
  const o = getOverrides();
  delete o[key];
  saveOverrides(o);
}

function hasKey() {
  return !!appSettings.getSettings().steamGridDbKey;
}

// Requête JSON authentifiée sur l'API SteamGridDB.
function apiGet(pathname, apiKey) {
  return new Promise((resolve, reject) => {
    https
      .get(
        { hostname: 'www.steamgriddb.com', path: pathname, headers: { Authorization: 'Bearer ' + apiKey } },
        (res) => {
          let raw = '';
          res.on('data', (c) => (raw += c));
          res.on('end', () => {
            if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
            try { resolve(JSON.parse(raw)); } catch (e) { reject(e); }
          });
        }
      )
      .on('error', reject);
  });
}

// Téléchargement d'un fichier (suit une redirection simple).
function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close();
          return download(res.headers.location, dest).then(resolve, reject);
        }
        if (res.statusCode !== 200) {
          file.close();
          try { fs.unlinkSync(dest); } catch (e) { /* ignore */ }
          return reject(new Error('HTTP ' + res.statusCode));
        }
        res.pipe(file);
        file.on('finish', () => file.close(() => resolve(dest)));
      })
      .on('error', (err) => {
        try { fs.unlinkSync(dest); } catch (e) { /* ignore */ }
        reject(err);
      });
  });
}

/**
 * Cherche la meilleure jaquette verticale pour un jeu, la télécharge et
 * l'enregistre comme surcharge pour gameKey.
 * @returns { ok:true, cover } ou { ok:false, error }
 */
async function fetchAndApply(gameKey, gameName) {
  const apiKey = appSettings.getSettings().steamGridDbKey;
  if (!apiKey) return { ok: false, error: 'noKey' };

  try {
    const search = await apiGet('/api/v2/search/autocomplete/' + encodeURIComponent(gameName), apiKey);
    const first = search && search.data && search.data[0];
    if (!first) return { ok: false, error: 'notFound' };

    const grids = await apiGet(
      '/api/v2/grids/game/' + first.id + '?dimensions=600x900&types=static&limit=1',
      apiKey
    );
    const g = grids && grids.data && grids.data[0];
    if (!g || !g.url) return { ok: false, error: 'noArtwork' };

    const dir = path.join(app.getPath('userData'), 'artwork');
    fs.mkdirSync(dir, { recursive: true });
    const extMatch = g.url.match(/\.(png|jpe?g|webp)/i);
    const ext = extMatch ? extMatch[1].toLowerCase() : 'png';
    const safe = String(gameKey).replace(/[^a-z0-9]+/gi, '_').slice(0, 70);
    const dest = path.join(dir, safe + '_' + Date.now() + '.' + ext);

    await download(g.url, dest);
    const fileUrl = pathToFileURL(dest).href;
    setOverride(gameKey, fileUrl);
    return { ok: true, cover: fileUrl };
  } catch (e) {
    return { ok: false, error: 'http', detail: e.message };
  }
}

module.exports = { getOverrides, setOverride, clearOverride, hasKey, fetchAndApply };
