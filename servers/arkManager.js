'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { parseIni, serializeIni, getSectionEntries, setEntry } = require('../services/iniFile');

function getConfigPath() {
  return path.join(app.getPath('userData'), 'ark_config.json');
}

function getRootFolder() {
  try {
    const p = getConfigPath();
    if (!fs.existsSync(p)) return null;
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    return data.rootFolder && fs.existsSync(data.rootFolder) ? data.rootFolder : null;
  } catch (e) {
    return null;
  }
}

function setRootFolder(folder) {
  const p = getConfigPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify({ rootFolder: folder }, null, 2), 'utf8');
}

/**
 * Les serveurs dédiés Ark (Ascended et Evolved) sont très souvent installés via
 * Steam/SteamCMD dans steamapps\common, sous des noms d'application fixes. On
 * réutilise donc la détection Steam déjà existante pour proposer automatiquement
 * ce dossier comme racine, sans que l'utilisateur ait à le chercher lui-même.
 * C'est la méthode la plus rapide, donc on l'essaie en premier.
 */
const STEAM_APP_FOLDER_NAMES = [
  'ARK Survival Ascended Dedicated Server',
  'ARK Survival Evolved Dedicated Server',
];

function autoDetectViaSteamLibraries() {
  let steamScanner;
  try {
    steamScanner = require('../scanners/steamScanner');
  } catch (e) {
    return null;
  }

  let steamPath;
  try {
    steamPath = steamScanner.getSteamInstallPath();
  } catch (e) {
    steamPath = null;
  }
  if (!steamPath) return null;

  const libraryFolders = steamScanner.getLibraryFolders(steamPath);

  for (const lib of libraryFolders) {
    const commonDir = path.join(lib, 'steamapps', 'common');
    if (!fs.existsSync(commonDir)) continue;

    const hasArkServer = STEAM_APP_FOLDER_NAMES.some((name) => fs.existsSync(path.join(commonDir, name)));
    if (hasArkServer) return commonDir;
  }

  return null;
}

/**
 * Repli si aucune bibliothèque Steam classique ne contient le serveur : beaucoup
 * d'admins installent leur serveur dédié via SteamCMD autonome (ex:
 * C:\steamcmd\steamapps\common\...), un outil totalement indépendant du client
 * Steam principal et donc invisible pour la méthode ci-dessus. On parcourt alors
 * les disques à la recherche de n'importe quel dossier contenant une structure
 * ShooterGame reconnaissable (le même critère que looksLikeArkServer), ce qui
 * fonctionne quel que soit le nom du dossier ou la méthode d'installation.
 *
 * Écrit en asynchrone (fs.promises) plutôt qu'en synchrone pour ne pas geler le
 * reste de l'application pendant la recherche, qui peut prendre plusieurs
 * secondes la première fois selon la taille des disques.
 */
const EXCLUDED_DIR_NAMES = new Set([
  'windows', '$recycle.bin', 'system volume information', 'programdata',
  'appdata', 'node_modules', '.git', 'recovery', 'msocache', 'perflogs',
  'documents and settings', 'boot', 'recycler', 'windowsapps',
]);

const MAX_SEARCH_DEPTH = 6;

async function findArkServerInstallAsync(dir, depth) {
  if (looksLikeArkServer(dir)) return dir;
  if (depth >= MAX_SEARCH_DEPTH) return null;

  let entries;
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch (e) {
    return null; // dossier inaccessible (permissions, etc.) : on ignore et on continue ailleurs
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (EXCLUDED_DIR_NAMES.has(entry.name.toLowerCase())) continue;

    const found = await findArkServerInstallAsync(path.join(dir, entry.name), depth + 1);
    if (found) return found;
  }

  return null;
}

function getFixedDrives() {
  const drives = [];
  for (let code = 67; code <= 90; code++) {
    // C: à Z: (on saute A:/B:, historiquement des lecteurs de disquette)
    const drive = `${String.fromCharCode(code)}:\\`;
    if (fs.existsSync(drive)) drives.push(drive);
  }
  return drives;
}

async function deepSearchArkServer() {
  for (const drive of getFixedDrives()) {
    const found = await findArkServerInstallAsync(drive, 0);
    if (found) return found;
  }
  return null;
}

async function autoDetectRootFolder() {
  const viaSteam = autoDetectViaSteamLibraries();
  if (viaSteam) return viaSteam;

  const foundServerPath = await deepSearchArkServer();
  return foundServerPath ? path.dirname(foundServerPath) : null;
}

/** Retourne le dossier racine connu, ou tente une détection automatique et la mémorise si trouvée. */
async function getOrAutoDetectRootFolder() {
  const existing = getRootFolder();
  if (existing) return { rootFolder: existing, autoDetected: false };

  const detected = await autoDetectRootFolder();
  if (detected) {
    setRootFolder(detected);
    return { rootFolder: detected, autoDetected: true };
  }

  return { rootFolder: null, autoDetected: false };
}

const CONFIG_SUBPATH = ['ShooterGame', 'Saved', 'Config', 'WindowsServer'];
const BINARIES_SUBPATH = ['ShooterGame', 'Binaries', 'Win64'];

function getConfigDir(serverPath) {
  return path.join(serverPath, ...CONFIG_SUBPATH);
}

function looksLikeArkServer(serverPath) {
  return fs.existsSync(path.join(serverPath, 'ShooterGame'));
}

function findServerExecutable(serverPath) {
  const binDir = path.join(serverPath, ...BINARIES_SUBPATH);
  if (!fs.existsSync(binDir)) return null;

  let files;
  try {
    files = fs.readdirSync(binDir).filter((f) => f.toLowerCase().endsWith('.exe'));
  } catch (e) {
    return null;
  }

  // Noms connus en priorité (Ascended, puis Evolved), sinon repli sur tout .exe contenant "server".
  // Important : on itère sur KNOWN_NAMES (pas sur "files") pour que la priorité soit vraiment
  // respectée, plutôt que de dépendre de l'ordre — non garanti — renvoyé par le système de fichiers.
  const KNOWN_NAMES = ['arkascendedserver.exe', 'shootergameserver.exe'];
  const lowerFiles = files.map((f) => f.toLowerCase());
  for (const knownName of KNOWN_NAMES) {
    const idx = lowerFiles.indexOf(knownName);
    if (idx !== -1) return path.join(binDir, files[idx]);
  }

  const fallback = files.find((f) => f.toLowerCase().includes('server'));
  return fallback ? path.join(binDir, fallback) : null;
}

// Doit correspondre exactement à ARK_EDITION_FOLDER_NAMES côté main.js.
const EDITION_FOLDER_NAMES = ['ARK Survival Ascended', 'ARK Survival Evolved'];

function buildServerDescriptor(serverPath, name) {
  const executable = findServerExecutable(serverPath);
  let edition = null;
  if (executable) {
    const exeName = path.basename(executable).toLowerCase();
    if (exeName.includes('ascended')) edition = 'ascended';
    else if (exeName.includes('shootergameserver')) edition = 'evolved';
  }

  return {
    id: serverPath, // le chemin complet, pas juste le nom : deux serveurs de même nom peuvent exister sous des éditions différentes
    name,
    path: serverPath,
    hasConfig: fs.existsSync(path.join(getConfigDir(serverPath), 'GameUserSettings.ini')),
    executable,
    edition,
  };
}

function listServers(rootFolder) {
  if (!rootFolder || !fs.existsSync(rootFolder)) return [];

  let entries;
  try {
    entries = fs.readdirSync(rootFolder, { withFileTypes: true }).filter((e) => e.isDirectory());
  } catch (e) {
    return [];
  }

  const servers = [];
  for (const entry of entries) {
    const entryPath = path.join(rootFolder, entry.name);

    if (looksLikeArkServer(entryPath)) {
      // Compatibilité : un serveur déjà créé directement à la racine (ancien
      // rangement, avant l'introduction des sous-dossiers par édition).
      servers.push(buildServerDescriptor(entryPath, entry.name));
      continue;
    }

    if (EDITION_FOLDER_NAMES.includes(entry.name)) {
      // Nouveau rangement : "ARK Survival Ascended" / "ARK Survival Evolved"
      // contiennent chacun les serveurs de cette édition, un niveau plus bas.
      let subEntries;
      try {
        subEntries = fs.readdirSync(entryPath, { withFileTypes: true }).filter((e) => e.isDirectory());
      } catch (e) {
        continue;
      }

      for (const subEntry of subEntries) {
        const subPath = path.join(entryPath, subEntry.name);
        if (looksLikeArkServer(subPath)) {
          servers.push(buildServerDescriptor(subPath, subEntry.name));
        }
      }
    }
  }

  return servers;
}

function backupFile(filePath) {
  try {
    fs.copyFileSync(filePath, `${filePath}.bak`);
  } catch (e) {
    // protection "best effort", non bloquante
  }
}

function readIniFile(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return parseIni(fs.readFileSync(filePath, 'utf8'));
}

function writeIniFile(filePath, lines) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (fs.existsSync(filePath)) backupFile(filePath);
  fs.writeFileSync(filePath, serializeIni(lines), 'utf8');
}

/**
 * Lit GameUserSettings.ini + Game.ini et retourne, pour chaque fichier, la
 * liste complète des sections/entrées (pour un éditeur avancé générique) ainsi
 * que quelques raccourcis pratiques pour les réglages les plus courants.
 */
function readSettings(serverPath) {
  const configDir = getConfigDir(serverPath);
  const gusPath = path.join(configDir, 'GameUserSettings.ini');
  const gamePath = path.join(configDir, 'Game.ini');

  const gusLines = readIniFile(gusPath);
  const gameLines = readIniFile(gamePath);

  return {
    gameUserSettings: {
      lines: gusLines,
      serverSettings: getSectionEntries(gusLines, 'ServerSettings'),
      sessionSettings: getSectionEntries(gusLines, 'SessionSettings'),
    },
    game: {
      lines: gameLines,
    },
  };
}

/**
 * Applique des mises à jour de la forme [{ file: 'gameUserSettings'|'game', section, key, value }]
 * aux deux fichiers ini et les enregistre (avec sauvegarde .bak automatique).
 */
function writeSettings(serverPath, updates) {
  const configDir = getConfigDir(serverPath);
  const gusPath = path.join(configDir, 'GameUserSettings.ini');
  const gamePath = path.join(configDir, 'Game.ini');

  let gusLines = readIniFile(gusPath);
  let gameLines = readIniFile(gamePath);

  for (const update of updates) {
    if (update.file === 'game') {
      gameLines = setEntry(gameLines, update.section, update.key, update.value);
    } else {
      gusLines = setEntry(gusLines, update.section, update.key, update.value);
    }
  }

  writeIniFile(gusPath, gusLines);
  writeIniFile(gamePath, gameLines);

  return readSettings(serverPath);
}

const LAUNCH_CONFIG_FILENAME = 'ma_ludotheque_launch_config.json';

const DEFAULT_LAUNCH_CONFIG = {
  map: 'TheIsland_WP',
  sessionName: 'Mon Serveur Ark',
  serverPassword: '',
  adminPassword: '',
  maxPlayers: 70,
  port: 7777,
  queryPort: 27015,
  extraSessionParams: '', // ex: "RCONEnabled=True?RCONPort=27020"
  extraFlags: '-server -log', // ex: "-server -log -NoBattlEye"
};

function readLaunchConfig(serverPath) {
  const filePath = path.join(serverPath, LAUNCH_CONFIG_FILENAME);
  if (!fs.existsSync(filePath)) return { ...DEFAULT_LAUNCH_CONFIG };

  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return { ...DEFAULT_LAUNCH_CONFIG, ...data };
  } catch (e) {
    return { ...DEFAULT_LAUNCH_CONFIG };
  }
}

function writeLaunchConfig(serverPath, config) {
  const filePath = path.join(serverPath, LAUNCH_CONFIG_FILENAME);
  const merged = { ...DEFAULT_LAUNCH_CONFIG, ...config };
  fs.writeFileSync(filePath, JSON.stringify(merged, null, 2), 'utf8');
  return merged;
}

/** Construit la chaîne d'arguments de lancement Ark (un seul argument "Carte?param=val?param=val"). */
function buildMapArgument(config) {
  const params = [
    'listen',
    `SessionName=${config.sessionName}`,
    config.serverPassword ? `ServerPassword=${config.serverPassword}` : null,
    config.adminPassword ? `ServerAdminPassword=${config.adminPassword}` : null,
    `MaxPlayers=${config.maxPlayers}`,
    `Port=${config.port}`,
    `QueryPort=${config.queryPort}`,
    config.extraSessionParams ? config.extraSessionParams.replace(/^\?/, '') : null,
  ].filter(Boolean);

  return `${config.map}?${params.join('?')}`;
}

function buildLaunchArgs(config) {
  const mapArg = buildMapArgument(config);
  const extraFlags = (config.extraFlags || '').split(/\s+/).filter(Boolean);
  return [mapArg, ...extraFlags];
}

/** Génère un script .bat autonome reprenant la configuration actuelle (pratique hors de l'appli). */
function generateLaunchScript(serverPath, config) {
  const exePath = findServerExecutable(serverPath);
  if (!exePath) throw new Error("Exécutable du serveur Ark introuvable.");

  const args = buildLaunchArgs(config);
  const quotedArgs = args.map((a) => `"${a}"`).join(' ');
  const content = [
    '@echo off',
    'REM Script genere par G-GameManager - Onglet Serveurs Ark',
    `"${exePath}" ${quotedArgs}`,
    'pause',
    '',
  ].join('\r\n');

  const scriptPath = path.join(serverPath, 'start_ark_server.bat');
  fs.writeFileSync(scriptPath, content, 'utf8');
  return scriptPath;
}

const KNOWN_MAPS = [
  { id: 'TheIsland_WP', label: 'The Island (Ascended)', edition: 'ascended' },
  { id: 'ScorchedEarth_WP', label: 'Scorched Earth (Ascended)', edition: 'ascended' },
  { id: 'TheCenter_WP', label: 'The Center (Ascended)', edition: 'ascended' },
  { id: 'Aberration_WP', label: 'Aberration (Ascended)', edition: 'ascended' },
  { id: 'Extinction_WP', label: 'Extinction (Ascended)', edition: 'ascended' },
  { id: 'TheIsland', label: 'The Island (Evolved)', edition: 'evolved' },
  { id: 'TheCenter', label: 'The Center (Evolved)', edition: 'evolved' },
  { id: 'ScorchedEarth_P', label: 'Scorched Earth (Evolved)', edition: 'evolved' },
  { id: 'Ragnarok', label: 'Ragnarok (Evolved)', edition: 'evolved' },
  { id: 'Aberration_P', label: 'Aberration (Evolved)', edition: 'evolved' },
  { id: 'Extinction', label: 'Extinction (Evolved)', edition: 'evolved' },
  { id: 'CrystalIsles', label: 'Crystal Isles (Evolved)', edition: 'evolved' },
  { id: 'LostIsland', label: 'Lost Island (Evolved)', edition: 'evolved' },
  { id: 'Fjordur', label: 'Fjordur (Evolved)', edition: 'evolved' },
];

module.exports = {
  getRootFolder,
  setRootFolder,
  autoDetectRootFolder,
  getOrAutoDetectRootFolder,
  listServers,
  readSettings,
  writeSettings,
  readLaunchConfig,
  writeLaunchConfig,
  buildMapArgument,
  buildLaunchArgs,
  generateLaunchScript,
  findServerExecutable,
  KNOWN_MAPS,
  DEFAULT_LAUNCH_CONFIG,
};
