'use strict';

const fs = require('fs');
const path = require('path');
const { queryValue } = require('./registryHelper');
const { parseVdf } = require('./vdfParser');
const { extractIconPng } = require('./iconExtractor');

function getSteamInstallPath() {
  let steamPath = queryValue('HKCU\\Software\\Valve\\Steam', 'SteamPath');
  if (steamPath) {
    steamPath = steamPath.replace(/\//g, '\\');
    if (fs.existsSync(steamPath)) return steamPath;
  }

  const fallback = queryValue('HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath');
  if (fallback && fs.existsSync(fallback)) return fallback;

  const defaults = ['C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam'];
  return defaults.find((d) => fs.existsSync(d)) || null;
}

function getLibraryFolders(steamPath) {
  const result = [steamPath];
  const vdfPath = path.join(steamPath, 'steamapps', 'libraryfolders.vdf');
  if (!fs.existsSync(vdfPath)) return result;

  try {
    const content = fs.readFileSync(vdfPath, 'utf8');
    const root = parseVdf(content);
    const libFolders = root['libraryfolders'];
    if (!libFolders || typeof libFolders !== 'object') return result;

    for (const key of Object.keys(libFolders)) {
      const entry = libFolders[key];
      if (entry && typeof entry === 'object' && entry.path) {
        const normalized = entry.path.replace(/\\\\/g, '\\');
        if (fs.existsSync(normalized) && !result.some((r) => r.toLowerCase() === normalized.toLowerCase())) {
          result.push(normalized);
        }
      }
    }
  } catch (e) {
    // fichier corrompu : on garde au moins le dossier Steam principal
  }

  return result;
}

function findIcon(steamPath, appId) {
  const cacheDir = path.join(steamPath, 'appcache', 'librarycache');
  if (!fs.existsSync(cacheDir)) return null;

  const candidates = [
    path.join(cacheDir, `${appId}_icon.jpg`),
    path.join(cacheDir, appId, 'icon.jpg'),
    path.join(cacheDir, `${appId}_logo.png`),
  ];

  return candidates.find((c) => fs.existsSync(c)) || null;
}

async function scanSteam() {
  const games = [];
  const steamPath = getSteamInstallPath();
  if (!steamPath) return games;

  const libraryFolders = getLibraryFolders(steamPath);

  for (const lib of libraryFolders) {
    const steamAppsDir = path.join(lib, 'steamapps');
    if (!fs.existsSync(steamAppsDir)) continue;

    let manifestFiles;
    try {
      manifestFiles = fs.readdirSync(steamAppsDir).filter((f) => /^appmanifest_.*\.acf$/i.test(f));
    } catch (e) {
      continue;
    }

    for (const file of manifestFiles) {
      try {
        const content = fs.readFileSync(path.join(steamAppsDir, file), 'utf8');
        const root = parseVdf(content);
        const appState = root['appstate'];
        if (!appState) continue;

        const appId = appState.appid;
        const name = appState.name;
        if (!appId || !name) continue;
        if (name.toLowerCase().includes('steamworks common redistributables')) continue;

        // Jaquette verticale officielle (grand format) servie par le CDN public de Valve,
        // aucune clé API nécessaire. Le renderer gère le cas où l'image n'existe pas
        // pour ce jeu (repli automatique sur l'icône, puis sur la lettre).
        const boxArtUrl = `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_600x900.jpg`;

        // L'icône du cache Steam est un .jpg local direct, pas besoin d'extraction PowerShell.
        const iconPath = findIcon(steamPath, appId);

        games.push({
          name,
          platform: 'steam',
          iconPath,
          boxArtUrl,
          launchMode: 'uri',
          launchTarget: `steam://rungameid/${appId}`,
        });
      } catch (e) {
        // manifeste corrompu, on passe au suivant
      }
    }
  }

  return games;
}

module.exports = { scanSteam, getLibraryFolders, getSteamInstallPath };
