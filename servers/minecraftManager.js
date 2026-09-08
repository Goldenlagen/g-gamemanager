'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { parsePropertiesFile, serializePropertiesFile, getValues, applyUpdates } = require('../services/propertiesFile');

function getConfigPath() {
  return path.join(app.getPath('userData'), 'minecraft_config.json');
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
 * Cherche le meilleur script de lancement dans un dossier de serveur :
 * .ps1 en priorité, puis .bat. En cas de plusieurs candidats, on privilégie
 * ceux dont le nom évoque un script de démarrage.
 */
function findLaunchScript(serverPath) {
  let files;
  try {
    files = fs.readdirSync(serverPath, { withFileTypes: true }).filter((f) => f.isFile());
  } catch (e) {
    return null;
  }

  const PRIORITY_WORDS = ['start', 'run', 'launch', 'server'];

  function pickBest(extension) {
    const candidates = files.filter((f) => f.name.toLowerCase().endsWith(extension));
    if (candidates.length === 0) return null;

    const prioritized = candidates.find((f) =>
      PRIORITY_WORDS.some((w) => f.name.toLowerCase().includes(w))
    );
    return (prioritized || candidates[0]).name;
  }

  const ps1 = pickBest('.ps1');
  if (ps1) return { fileName: ps1, type: 'ps1' };

  const bat = pickBest('.bat');
  if (bat) return { fileName: bat, type: 'bat' };

  return null;
}

/**
 * Un dossier est considéré comme un serveur Minecraft valide s'il a des marqueurs
 * reconnaissables. On inclut la présence d'un script de lancement (start/run
 * .ps1/.bat) : les serveurs modés récents (Forge/NeoForge 1.17+) n'ont pas de
 * .jar à la racine ni de server.properties/eula tant qu'ils n'ont pas été
 * démarrés une première fois — leur seul marqueur fiable est leur script.
 */
function looksLikeMinecraftServer(serverPath) {
  const hasProperties = fs.existsSync(path.join(serverPath, 'server.properties'));
  const hasEula = fs.existsSync(path.join(serverPath, 'eula.txt'));

  let hasJar = false;
  try {
    hasJar = fs.readdirSync(serverPath).some((f) => f.toLowerCase().endsWith('.jar'));
  } catch (e) {
    hasJar = false;
  }

  const hasScript = !!findLaunchScript(serverPath);

  return hasProperties || hasEula || hasJar || hasScript;
}

/**
 * Cherche le dossier serveur le MOINS profond à l'intérieur de `rootDir`
 * (rootDir inclus), en parcours en largeur limité à `maxDepth`. Utile quand un
 * serverpack a été extrait dans un sous-dossier (ex:
 * MonServeur/NomDuPack/start.ps1) : on retrouve alors le vrai dossier serveur.
 * Le parcours en largeur garantit qu'on retourne le niveau le plus haut d'abord
 * (le dossier serveur lui-même plutôt que son sous-dossier mods/ qui contient
 * aussi des .jar).
 */
function findServerDir(rootDir, maxDepth = 3) {
  const queue = [{ dir: rootDir, depth: 0 }];
  while (queue.length > 0) {
    const { dir, depth } = queue.shift();
    if (looksLikeMinecraftServer(dir)) return dir;
    if (depth >= maxDepth) continue;

    let subs;
    try {
      subs = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory());
    } catch (e) {
      subs = [];
    }
    // On évite de plonger dans les dossiers internes classiques d'un serveur.
    const SKIP = new Set(['mods', 'libraries', 'config', 'world', 'logs', 'crash-reports', 'defaultconfigs', 'kubejs']);
    for (const s of subs) {
      if (SKIP.has(s.name.toLowerCase())) continue;
      queue.push({ dir: path.join(dir, s.name), depth: depth + 1 });
    }
  }
  return null;
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
    const topPath = path.join(rootFolder, entry.name);
    // Le script/les fichiers peuvent être dans un sous-dossier : on descend.
    const serverPath = findServerDir(topPath, 3);
    if (!serverPath) continue;

    const script = findLaunchScript(serverPath);
    servers.push({
      id: entry.name,
      name: entry.name,
      path: serverPath,
      hasProperties: fs.existsSync(path.join(serverPath, 'server.properties')),
      launchScript: script ? script.fileName : null,
      launchScriptType: script ? script.type : null,
    });
  }

  return servers;
}

function readServerProperties(serverPath) {
  const filePath = path.join(serverPath, 'server.properties');
  if (!fs.existsSync(filePath)) return { lines: [], values: {} };

  const content = fs.readFileSync(filePath, 'utf8');
  const lines = parsePropertiesFile(content);
  return { lines, values: getValues(lines) };
}

function backupFile(filePath) {
  try {
    const backupPath = `${filePath}.bak`;
    fs.copyFileSync(filePath, backupPath);
  } catch (e) {
    // La sauvegarde est une protection "best effort" : si elle échoue on
    // n'empêche pas l'enregistrement principal pour autant.
  }
}

function writeServerProperties(serverPath, updates) {
  const filePath = path.join(serverPath, 'server.properties');
  const content = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  const lines = parsePropertiesFile(content);
  const updatedLines = applyUpdates(lines, updates);

  if (fs.existsSync(filePath)) backupFile(filePath);
  fs.writeFileSync(filePath, serializePropertiesFile(updatedLines), 'utf8');

  return getValues(updatedLines);
}

const JVM_ARGS_FILENAME = 'user_jvm_args.txt';

/**
 * Lit les arguments de lancement JVM via le mécanisme standard user_jvm_args.txt
 * (une option par ligne, lignes "#" ignorées) utilisé par Mojang/Forge/NeoForge/
 * Fabric. On ne tente PAS de modifier un script de lancement existant dont on
 * ne connaît pas la structure : c'est plus sûr et ça fonctionne dans tous les
 * cas dès lors que le script utilise bien "java @user_jvm_args.txt ...".
 */
function readLaunchArgs(serverPath) {
  const filePath = path.join(serverPath, JVM_ARGS_FILENAME);
  const exists = fs.existsSync(filePath);

  if (!exists) {
    return { exists: false, argsText: '' };
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const argsText = content
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n')
    .trim();

  return { exists: true, argsText };
}

function writeLaunchArgs(serverPath, argsText) {
  const filePath = path.join(serverPath, JVM_ARGS_FILENAME);

  const header = [
    '# Arguments JVM générés/gérés par G-GameManager.',
    '# Une option par ligne (ex: -Xmx4G). Nécessite que votre script de',
    '# lancement utilise : java @user_jvm_args.txt -jar server.jar nogui',
    '',
  ].join('\n');

  const argLines = argsText
    .split(/\s+/)
    .map((a) => a.trim())
    .filter(Boolean);

  if (fs.existsSync(filePath)) backupFile(filePath);
  fs.writeFileSync(filePath, header + argLines.join('\n') + '\n', 'utf8');

  return { exists: true, argsText: argLines.join('\n') };
}

// ---- Listes d'accès : whitelist / ops / bans ----

const ACCESS_FILES = {
  whitelist: 'whitelist.json',
  ops: 'ops.json',
  bans: 'banned-players.json',
};

function readJsonArray(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return Array.isArray(data) ? data : [];
    }
  } catch (e) {
    /* fichier absent ou corrompu : liste vide */
  }
  return [];
}

/** Lit whitelist.json / ops.json / banned-players.json et renvoie des listes normalisées. */
function readAccessLists(serverPath) {
  const wl = readJsonArray(path.join(serverPath, ACCESS_FILES.whitelist));
  const ops = readJsonArray(path.join(serverPath, ACCESS_FILES.ops));
  const bans = readJsonArray(path.join(serverPath, ACCESS_FILES.bans));
  return {
    whitelist: wl.map((e) => ({ name: e.name || '', uuid: e.uuid || '' })),
    ops: ops.map((e) => ({ name: e.name || '', uuid: e.uuid || '', level: e.level })),
    bans: bans.map((e) => ({ name: e.name || '', uuid: e.uuid || '', reason: e.reason || '' })),
  };
}

/** Ajoute une entrée dans le fichier JSON d'une liste (édition hors-ligne, serveur arrêté). */
function addToAccessFile(serverPath, list, entry) {
  const file = ACCESS_FILES[list];
  if (!file) return;
  const fp = path.join(serverPath, file);
  const arr = readJsonArray(fp);
  const exists = arr.some((e) => (e.name || '').toLowerCase() === (entry.name || '').toLowerCase());
  if (!exists) arr.push(entry);
  fs.writeFileSync(fp, JSON.stringify(arr, null, 2), 'utf8');
}

/** Retire une entrée (par nom) du fichier JSON d'une liste. */
function removeFromAccessFile(serverPath, list, name) {
  const file = ACCESS_FILES[list];
  if (!file) return;
  const fp = path.join(serverPath, file);
  const arr = readJsonArray(fp).filter((e) => (e.name || '').toLowerCase() !== String(name).toLowerCase());
  fs.writeFileSync(fp, JSON.stringify(arr, null, 2), 'utf8');
}

// ---- Serverpacks installés (pour interdire un re-téléchargement) ----

const SERVERPACK_MARKER = '.ggserverpack.json';

function readServerpackMarker(dir) {
  try {
    const m = path.join(dir, SERVERPACK_MARKER);
    if (fs.existsSync(m)) return JSON.parse(fs.readFileSync(m, 'utf8'));
  } catch (e) {
    // ignore
  }
  return null;
}

function writeServerpackMarker(dir, meta) {
  try {
    fs.writeFileSync(path.join(dir, SERVERPACK_MARKER), JSON.stringify(meta, null, 2), 'utf8');
  } catch (e) {
    // best-effort
  }
}

// Normalisation d'un nom pour comparer un dossier serveur au nom d'un modpack
// (insensible à la casse, à la ponctuation et aux espaces).
function normalizeName(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Inspecte le dossier racine des serveurs et renvoie ce qui est déjà installé :
 *  - keys : "modId:serverPackFileId" issus de nos marqueurs (.ggserverpack.json),
 *           donc précis à la version près pour les serverpacks qu'on a installés ;
 *  - names : noms normalisés des dossiers serveurs détectés (permet de repérer
 *            un serveur déjà présent même sans marqueur, par correspondance de nom).
 */
function getInstalledServerpacks(rootFolder) {
  const root = rootFolder || getRootFolder();
  const keys = [];
  const names = [];
  if (!root || !fs.existsSync(root)) return { keys, names };

  const servers = listServers(root);
  for (const s of servers) {
    names.push(normalizeName(s.name));
    // Le marqueur est écrit à la racine du dossier du serveur (après aplatissement),
    // mais on regarde aussi le dossier de plus haut niveau par sécurité.
    const marker =
      readServerpackMarker(s.path) || readServerpackMarker(path.join(root, s.id));
    if (marker && marker.modId && marker.serverPackFileId) {
      keys.push(marker.modId + ':' + marker.serverPackFileId);
    }
  }
  return { keys, names };
}

module.exports = {
  getRootFolder,
  setRootFolder,
  listServers,
  readServerProperties,
  writeServerProperties,
  readLaunchArgs,
  writeLaunchArgs,
  findLaunchScript,
  readServerpackMarker,
  writeServerpackMarker,
  getInstalledServerpacks,
  readAccessLists,
  addToAccessFile,
  removeFromAccessFile,
  normalizeName,
  JVM_ARGS_FILENAME,
  SERVERPACK_MARKER,
};
