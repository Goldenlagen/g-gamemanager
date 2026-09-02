'use strict';

const fs = require('fs');
const path = require('path');
const { extractIconPng } = require('./iconExtractor');

// Noms d'affichage connus pour les produits Riot les plus courants (l'identifiant
// technique interne diffère souvent du nom commercial : "bacon" = Legends of Runeterra).
const DISPLAY_NAMES = {
  league_of_legends: 'League of Legends',
  valorant: 'VALORANT',
  bacon: 'Legends of Runeterra',
};

// Composants internes Riot qui apparaissent dans le dossier Metadata mais ne sont
// pas des jeux à afficher (client, anti-triche, installeurs...).
const EXCLUDED_PRODUCT_PREFIXES = [
  'riot_client',
  'vanguard',
  'sync_client',
  'ux',
  'common',
  'league_client_installer',
  'valorant_installer',
  'installer',
];

function getProgramDataPath() {
  return process.env.ProgramData || 'C:\\ProgramData';
}

function getRiotClientPath() {
  try {
    const installsJson = path.join(getProgramDataPath(), 'Riot Games', 'RiotClientInstalls.json');
    if (fs.existsSync(installsJson)) {
      const data = JSON.parse(fs.readFileSync(installsJson, 'utf8'));
      for (const key of ['rc_default', 'rc_live', 'rc_beta']) {
        if (data[key] && fs.existsSync(data[key])) return data[key];
      }
    }
  } catch (e) {
    // on retombe sur les chemins par défaut / la déduction depuis un jeu détecté
  }

  const defaults = [
    'C:\\Riot Games\\Riot Client\\RiotClientServices.exe',
    'C:\\Program Files\\Riot Games\\Riot Client\\RiotClientServices.exe',
    'C:\\Program Files (x86)\\Riot Games\\Riot Client\\RiotClientServices.exe',
  ];

  return defaults.find((d) => fs.existsSync(d)) || null;
}

/**
 * Déduit le chemin de RiotClientServices.exe à partir du dossier d'installation
 * d'un jeu détecté : les jeux Riot et le Riot Client partagent en général le même
 * dossier racine "Riot Games" (ex: D:\Jeux\Riot Games\League of Legends et
 * D:\Jeux\Riot Games\Riot Client), même quand ce n'est pas sur C:.
 */
function deriveRiotClientPathFromGameInstall(installPath) {
  try {
    const riotGamesRoot = path.dirname(installPath); // parent du dossier du jeu
    const candidate = path.join(riotGamesRoot, 'Riot Client', 'RiotClientServices.exe');
    return fs.existsSync(candidate) ? candidate : null;
  } catch (e) {
    return null;
  }
}

/**
 * Extrait la valeur de "product_install_full_path" d'un fichier product_settings.yaml.
 * On évite une dépendance à un parseur YAML complet : ce fichier ne contient que des
 * paires clé/valeur simples sur une ligne pour les champs qui nous intéressent.
 */
function extractInstallPathFromYaml(content) {
  const match = content.match(/product_install_full_path\s*:\s*"?([^"\r\n]+)"?/i);
  if (!match) return null;
  return match[1].trim();
}

function toDisplayName(productId) {
  if (DISPLAY_NAMES[productId]) return DISPLAY_NAMES[productId];
  // Fallback générique pour un futur jeu Riot non encore répertorié ci-dessus :
  // "team_fight_tactics" -> "Team Fight Tactics"
  return productId
    .split(/[_-]/)
    .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/**
 * Méthode principale (fiable) : lit les métadonnées que Riot écrit réellement sur
 * le disque pour chaque produit installé, ce qui fonctionne quel que soit le
 * disque ou le dossier d'installation choisi par l'utilisateur.
 */
function scanFromMetadata() {
  const games = [];
  const metadataDir = path.join(getProgramDataPath(), 'Riot Games', 'Metadata');
  if (!fs.existsSync(metadataDir)) return games;

  let productFolders;
  try {
    productFolders = fs.readdirSync(metadataDir).filter((f) => f.toLowerCase().endsWith('.live'));
  } catch (e) {
    return games;
  }

  for (const folder of productFolders) {
    const productId = folder.replace(/\.live$/i, '').toLowerCase();
    if (EXCLUDED_PRODUCT_PREFIXES.some((p) => productId.startsWith(p))) continue;

    const productDir = path.join(metadataDir, folder);
    let yamlFile;
    try {
      yamlFile = fs.readdirSync(productDir).find((f) => f.toLowerCase().endsWith('.product_settings.yaml'));
    } catch (e) {
      continue;
    }
    if (!yamlFile) continue;

    let installPath;
    try {
      const content = fs.readFileSync(path.join(productDir, yamlFile), 'utf8');
      installPath = extractInstallPathFromYaml(content);
    } catch (e) {
      continue;
    }

    if (!installPath || !fs.existsSync(installPath)) continue;

    games.push({
      productId,
      displayName: toDisplayName(productId),
      installPath,
    });
  }

  return games;
}

/**
 * Repli best-effort (ancienne méthode) : vérifie des dossiers d'installation par
 * défaut connus. Utile si jamais le dossier Metadata est absent ou dans un format
 * que scanFromMetadata ne reconnaît pas.
 */
function scanFromDefaultFolders() {
  const KNOWN_GAMES = [
    { productId: 'league_of_legends', folders: ['League of Legends'] },
    { productId: 'valorant', folders: ['VALORANT'] },
    { productId: 'bacon', folders: ['LoR'] },
  ];

  const roots = ['C:\\Riot Games'];
  for (let code = 68; code <= 90; code++) {
    const drive = `${String.fromCharCode(code)}:\\`;
    if (fs.existsSync(drive)) roots.push(path.join(drive, 'Riot Games'));
  }

  const games = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const game of KNOWN_GAMES) {
      for (const folder of game.folders) {
        const gameDir = path.join(root, folder);
        if (fs.existsSync(gameDir)) {
          games.push({ productId: game.productId, displayName: toDisplayName(game.productId), installPath: gameDir });
        }
      }
    }
  }
  return games;
}

async function scanRiot() {
  const games = [];
  const seenProductIds = new Set();

  let riotClientPath = getRiotClientPath();

  const detected = [...scanFromMetadata(), ...scanFromDefaultFolders()];

  for (const entry of detected) {
    if (seenProductIds.has(entry.productId)) continue;

    if (!riotClientPath) {
      riotClientPath = deriveRiotClientPathFromGameInstall(entry.installPath);
    }
    if (!riotClientPath) continue; // sans le client Riot, impossible de lancer le jeu

    seenProductIds.add(entry.productId);

    let iconPath = null;
    try {
      const exeInDir = fs.readdirSync(entry.installPath).find((f) => f.toLowerCase().endsWith('.exe'));
      if (exeInDir) iconPath = await extractIconPng(path.join(entry.installPath, exeInDir));
    } catch (e) {
      // dossier illisible, tant pis pour l'icône
    }

    games.push({
      name: entry.displayName,
      platform: 'riot',
      iconPath,
      launchMode: 'exe',
      launchTarget: riotClientPath,
      launchArgs: [`--launch-product=${entry.productId}`, '--launch-patchline=live'],
      workingDirectory: path.dirname(riotClientPath),
    });
  }

  return games;
}

module.exports = {
  scanRiot,
  getRiotClientPath,
  scanFromMetadata,
  scanFromDefaultFolders,
  extractInstallPathFromYaml,
  toDisplayName,
  deriveRiotClientPathFromGameInstall,
};
