'use strict';

// Intégration avec le launcher Minecraft officiel (Mojang) :
//  - lecture/écriture de launcher_profiles.json
//  - gestion des "instances" (un dossier de jeu dédié par modpack)
//  - installation des mod loaders (Fabric / Forge / NeoForge)
//  - détection de Java
//
// Aucune dépendance npm : requêtes via https natif, extraction/installeurs via
// PowerShell et java en ligne de commande (Windows).

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { execFile, spawn } = require('child_process');
const { app } = require('electron');
const appSettings = require('./appSettings');
const i18n = require('./i18n');

// ---- Emplacements ----

function getMinecraftDir() {
  // Surcharge possible via les réglages (si le .minecraft n'est pas au défaut).
  const override = appSettings.getSettings().minecraftDir;
  if (override && fs.existsSync(override)) return override;
  // Défaut Windows : %APPDATA%\.minecraft
  return path.join(app.getPath('appData'), '.minecraft');
}

function getProfilesPath() {
  return path.join(getMinecraftDir(), 'launcher_profiles.json');
}

function getVersionsDir() {
  return path.join(getMinecraftDir(), 'versions');
}

// Les instances (un dossier de jeu isolé par modpack) sont rangées dans un
// sous-dossier dédié du .minecraft pour ne pas polluer le dossier principal.
function getInstancesDir() {
  return path.join(getMinecraftDir(), 'gg-instances');
}

function slugify(name) {
  return String(name || 'modpack')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'modpack';
}

// ---- Utilitaires HTTP ----

function httpsGetJson(url, headers = {}) {
  return new Promise((resolve) => {
    https
      .get(url, { headers: { Accept: 'application/json', ...headers } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          resolve(httpsGetJson(res.headers.location, headers));
          return;
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          res.resume();
          resolve({ ok: false, status: res.statusCode, error: 'HTTP ' + res.statusCode });
          return;
        }
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          try {
            resolve({ ok: true, data: JSON.parse(raw) });
          } catch (e) {
            resolve({ ok: false, error: 'JSON invalide' });
          }
        });
      })
      .on('error', (err) => resolve({ ok: false, error: err.message }));
  });
}

function httpsGetText(url) {
  return new Promise((resolve) => {
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          resolve(httpsGetText(res.headers.location));
          return;
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          res.resume();
          resolve({ ok: false, status: res.statusCode });
          return;
        }
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (raw += c));
        res.on('end', () => resolve({ ok: true, data: raw }));
      })
      .on('error', (err) => resolve({ ok: false, error: err.message }));
  });
}

/** Télécharge une URL vers un fichier, en suivant les redirections. */
function downloadToFile(url, destFile, headers = {}, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    function doGet(current, left) {
      let parsed;
      try {
        parsed = new URL(current);
      } catch (e) {
        reject(new Error('URL invalide : ' + current));
        return;
      }
      https
        .get(current, { headers }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && left > 0) {
            res.resume();
            doGet(new URL(res.headers.location, parsed).href, left - 1);
            return;
          }
          if (res.statusCode !== 200) {
            res.resume();
            reject(new Error('HTTP ' + res.statusCode + ' pour ' + current));
            return;
          }
          const out = fs.createWriteStream(destFile);
          res.pipe(out);
          out.on('finish', () => out.close(() => resolve()));
          out.on('error', reject);
        })
        .on('error', reject);
    }
    doGet(url, maxRedirects);
  });
}

// ---- Détection de Java ----

function detectJava() {
  return new Promise((resolve) => {
    execFile('java', ['-version'], { windowsHide: true, timeout: 10000 }, (err) => {
      resolve(!err);
    });
  });
}

// ---- Parsing de l'identifiant de loader ----

/**
 * Sépare "forge-47.2.0" -> { name:'forge', version:'47.2.0' } et gère les
 * versions contenant elles-mêmes des tirets ("neoforge-21.0.0-beta" ->
 * { name:'neoforge', version:'21.0.0-beta' }) en coupant sur le PREMIER tiret
 * seulement. C'est le piège principal quand on reconstruit ensuite des URLs.
 */
function parseLoaderId(loaderId) {
  const id = String(loaderId || '');
  const idx = id.indexOf('-');
  if (idx === -1) return { name: id.toLowerCase(), version: '' };
  return { name: id.slice(0, idx).toLowerCase(), version: id.slice(idx + 1) };
}

// ---- Installation Fabric (écrit le JSON de version, sans Java) ----

async function installFabric(mcVersion, loaderVersion) {
  // https://meta.fabricmc.net/v2/versions/loader/{mc}/{loader}/profile/json
  const url =
    'https://meta.fabricmc.net/v2/versions/loader/' +
    encodeURIComponent(mcVersion) + '/' + encodeURIComponent(loaderVersion) + '/profile/json';

  const res = await httpsGetJson(url);
  if (!res.ok || !res.data || !res.data.id) {
    return { ok: false, error: i18n.t('mcl.fabricProfileFail', { error: res.error || i18n.t('mcl.invalidResponse') }) };
  }

  const versionId = res.data.id; // ex: "fabric-loader-0.15.7-1.20.1"
  const dir = path.join(getVersionsDir(), versionId);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, versionId + '.json'), JSON.stringify(res.data, null, 2), 'utf8');
  } catch (e) {
    return { ok: false, error: i18n.t('mcl.fabricWriteFail', { error: e.message }) };
  }
  return { ok: true, versionId };
}

// ---- Installation via installeur .jar (Forge / NeoForge) ----

function runInstaller(jarPath, mcDir) {
  return new Promise((resolve) => {
    // --installClient <chemin .minecraft> : mode non interactif des installeurs
    // Forge/NeoForge (installe la version dans versions/ et les librairies).
    execFile(
      'java',
      ['-jar', jarPath, '--installClient', mcDir],
      { windowsHide: true, timeout: 600000, cwd: path.dirname(jarPath) },
      (err, stdout, stderr) => {
        if (err) resolve({ ok: false, error: (stderr || err.message || '').toString().slice(0, 500) });
        else resolve({ ok: true });
      }
    );
  });
}

function findNewestVersionIdMatching(predicate) {
  let versions;
  try {
    versions = fs.readdirSync(getVersionsDir(), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter(predicate);
  } catch (e) {
    return null;
  }
  if (versions.length === 0) return null;
  // Le plus récemment modifié (dernier installé).
  versions.sort((a, b) => {
    const ma = safeMtime(path.join(getVersionsDir(), a));
    const mb = safeMtime(path.join(getVersionsDir(), b));
    return mb - ma;
  });
  return versions[0];
}

function safeMtime(p) {
  try {
    return fs.statSync(p).mtimeMs;
  } catch (e) {
    return 0;
  }
}

async function installForge(mcVersion, forgeVersion, tmpDir) {
  const combo = mcVersion + '-' + forgeVersion;
  const jarUrl =
    'https://maven.minecraftforge.net/net/minecraftforge/forge/' +
    combo + '/forge-' + combo + '-installer.jar';
  return installFromJar(jarUrl, tmpDir, 'forge', (name) =>
    name.toLowerCase().includes('forge') && name.includes(mcVersion) && !name.toLowerCase().includes('neoforge')
  );
}

async function installNeoForge(neoVersion, tmpDir) {
  const jarUrl =
    'https://maven.neoforged.net/releases/net/neoforged/neoforge/' +
    neoVersion + '/neoforge-' + neoVersion + '-installer.jar';
  return installFromJar(jarUrl, tmpDir, 'neoforge', (name) =>
    name.toLowerCase().includes('neoforge')
  );
}

async function installFromJar(jarUrl, tmpDir, kind, matchPredicate) {
  const jarPath = path.join(tmpDir, kind + '-installer.jar');
  try {
    await downloadToFile(jarUrl, jarPath);
  } catch (e) {
    return { ok: false, error: i18n.t('mcl.installerDownloadFail', { kind, error: e.message }) };
  }

  const before = new Set(safeReaddir(getVersionsDir()));
  const run = await runInstaller(jarPath, getMinecraftDir());
  if (!run.ok) {
    return { ok: false, error: i18n.t('mcl.installerFail', { kind, error: run.error }) };
  }

  // Détermine l'id de version nouvellement créé (diff avant/après, sinon match).
  const after = safeReaddir(getVersionsDir());
  const created = after.find((n) => !before.has(n) && matchPredicate(n));
  const versionId = created || findNewestVersionIdMatching(matchPredicate);
  if (!versionId) {
    return { ok: false, error: i18n.t('mcl.installerNoVersion', { kind }) };
  }
  return { ok: true, versionId };
}

function safeReaddir(dir) {
  try {
    return fs.readdirSync(dir);
  } catch (e) {
    return [];
  }
}

/**
 * Installe le loader décrit par l'id de manifest CurseForge.
 * @returns { ok, versionId } ou { ok:false, error, needsJava }
 */
async function installLoader(loaderId, mcVersion, tmpDir) {
  const { name, version } = parseLoaderId(loaderId);

  if (name === 'fabric') {
    return installFabric(mcVersion, version);
  }
  if (name === 'quilt') {
    // Quilt expose une API meta compatible.
    const url =
      'https://meta.quiltmc.org/v3/versions/loader/' +
      encodeURIComponent(mcVersion) + '/' + encodeURIComponent(version) + '/profile/json';
    const res = await httpsGetJson(url);
    if (!res.ok || !res.data || !res.data.id) return { ok: false, error: i18n.t('mcl.quiltUnavailable') };
    const versionId = res.data.id;
    const dir = path.join(getVersionsDir(), versionId);
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, versionId + '.json'), JSON.stringify(res.data, null, 2), 'utf8');
    } catch (e) {
      return { ok: false, error: i18n.t('mcl.quiltWriteFail', { error: e.message }) };
    }
    return { ok: true, versionId };
  }

  // Forge / NeoForge nécessitent Java (exécution de l'installeur officiel).
  const hasJava = await detectJava();
  if (!hasJava) {
    return {
      ok: false,
      needsJava: true,
      error: i18n.t('mcl.needJava', { name }),
    };
  }

  if (name === 'forge') return installForge(mcVersion, version, tmpDir);
  if (name === 'neoforge') return installNeoForge(version, tmpDir);

  return { ok: false, error: i18n.t('mcl.loaderUnsupported', { name }) };
}

// ---- launcher_profiles.json ----

function readLauncherProfiles() {
  const p = getProfilesPath();
  try {
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    }
  } catch (e) {
    // fichier corrompu : on repart d'un squelette pour ne pas bloquer, mais on
    // sauvegardera l'original avant écriture.
  }
  return { profiles: {}, settings: {}, version: 3 };
}

function backup(filePath) {
  try {
    if (fs.existsSync(filePath)) fs.copyFileSync(filePath, filePath + '.bak');
  } catch (e) {
    // best-effort
  }
}

/**
 * Crée ou met à jour un profil dans le launcher officiel.
 * @param {object} opts { name, versionId, gameDir, iconDataUri, javaArgs }
 */
function upsertProfile(opts) {
  const { name, versionId, gameDir, iconDataUri, javaArgs } = opts;
  const p = getProfilesPath();

  if (!fs.existsSync(getMinecraftDir())) {
    return { ok: false, error: i18n.t('mcl.mcDirNotFound', { dir: getMinecraftDir() }) };
  }

  const data = readLauncherProfiles();
  if (!data.profiles) data.profiles = {};

  // On réutilise un profil existant qui pointe vers le même gameDir (réinstall),
  // sinon on en crée un nouveau avec une clé aléatoire.
  let key = Object.keys(data.profiles).find((k) => {
    const pr = data.profiles[k];
    return pr && pr.gameDir && path.resolve(pr.gameDir) === path.resolve(gameDir);
  });
  if (!key) key = crypto.randomBytes(16).toString('hex');

  const now = new Date().toISOString();
  const existing = data.profiles[key] || {};

  data.profiles[key] = {
    ...existing,
    name,
    type: 'custom',
    created: existing.created || now,
    lastUsed: existing.lastUsed || now,
    lastVersionId: versionId,
    gameDir,
    icon: iconDataUri || existing.icon || 'Furnace',
    javaArgs: javaArgs || existing.javaArgs || undefined,
  };

  try {
    backup(p);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    return { ok: false, error: i18n.t('mcl.profilesWriteFail', { error: e.message }) };
  }
  return { ok: true, key };
}

// ---- Instances / marqueurs ----

const MARKER = '.ggmodpack.json';

function readInstanceMarker(instanceDir) {
  try {
    const m = path.join(instanceDir, MARKER);
    if (fs.existsSync(m)) return JSON.parse(fs.readFileSync(m, 'utf8'));
  } catch (e) {
    // ignore
  }
  return null;
}

function writeInstanceMarker(instanceDir, meta) {
  try {
    fs.writeFileSync(path.join(instanceDir, MARKER), JSON.stringify(meta, null, 2), 'utf8');
  } catch (e) {
    // best-effort
  }
}

/**
 * Lit un minecraftinstance.json (créé par l'application CurseForge/Overwolf)
 * présent dans le dossier d'un profil, et en extrait l'identité CurseForge.
 * Ne renvoie un résultat QUE si on trouve à la fois un projectID et un fileID :
 * c'est la preuve que ce profil correspond bien à un modpack CurseForge.
 */
function readCurseForgeInstance(gameDir) {
  try {
    const p = path.join(gameDir, 'minecraftinstance.json');
    if (!fs.existsSync(p)) return null;
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));

    const im = j.installedModpack || {};
    const modId = Number(im.addonID || j.projectID || (j.manifest && j.manifest.projectID) || 0) || null;
    let fileId =
      (im.installedFile && im.installedFile.id) ||
      im.installedFileId ||
      j.fileID ||
      (j.manifest && j.manifest.fileID) ||
      0;
    fileId = Number(fileId) || null;

    if (!modId || !fileId) return null;

    const name = j.name || (j.manifest && j.manifest.name) || null;
    const mcVersion = j.gameVersion || (j.baseModLoader && j.baseModLoader.gameVersion) || null;

    let loader = null;
    let loaderVersion = null;
    const loaderName = j.baseModLoader && j.baseModLoader.name;
    if (loaderName) {
      const idx = loaderName.indexOf('-');
      if (idx === -1) loader = loaderName.toLowerCase();
      else {
        loader = loaderName.slice(0, idx).toLowerCase();
        loaderVersion = loaderName.slice(idx + 1);
      }
    }

    return { modId, fileId, name, mcVersion, loader, loaderVersion };
  } catch (e) {
    return null;
  }
}

/**
 * Détermine si un dossier de jeu correspond à un modpack, via notre propre
 * marqueur en priorité, sinon via un minecraftinstance.json CurseForge. Dans ce
 * dernier cas, on écrit notre marqueur pour tagger durablement le profil.
 */
function detectModpackInfo(gameDir) {
  if (!gameDir) return null;

  const marker = readInstanceMarker(gameDir);
  if (marker && marker.modId) {
    return {
      modId: marker.modId,
      fileId: marker.fileId,
      name: marker.name || null,
      mcVersion: marker.mcVersion || null,
      loader: marker.loader || null,
      loaderVersion: marker.loaderVersion || null,
      source: marker.source || 'gg',
    };
  }

  const cf = readCurseForgeInstance(gameDir);
  if (cf) {
    // On tag durablement ce profil détecté comme modpack CurseForge.
    writeInstanceMarker(gameDir, {
      modId: cf.modId,
      fileId: cf.fileId,
      name: cf.name,
      mcVersion: cf.mcVersion,
      loader: cf.loader,
      loaderVersion: cf.loaderVersion,
      source: 'curseforge',
      taggedAt: new Date().toISOString(),
    });
    return { ...cf, source: 'curseforge' };
  }

  return null;
}

/**
 * Liste les modpacks déjà installés (pour griser le re-téléchargement) :
 * agrège les profils du launcher (dont ceux détectés via CurseForge) et les
 * instances de gg-instances, dédupliqués par modId:fileId.
 */
function listInstalledModpacks() {
  const result = [];
  const seen = new Set();

  function add(info) {
    if (!info || !info.modId || !info.fileId) return;
    const k = info.modId + ':' + info.fileId;
    if (seen.has(k)) return;
    seen.add(k);
    result.push(info);
  }

  // 1) via les profils du launcher officiel
  const data = readLauncherProfiles();
  for (const key of Object.keys(data.profiles || {})) {
    const pr = data.profiles[key] || {};
    if (pr.gameDir) add(detectModpackInfo(pr.gameDir));
  }

  // 2) via nos instances (au cas où un profil aurait été supprimé mais pas le dossier)
  try {
    const dir = getInstancesDir();
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) add(detectModpackInfo(path.join(dir, e.name)));
    }
  } catch (e) {
    // pas de dossier d'instances : rien à ajouter
  }

  return result;
}

// Mots-clés indiquant qu'un profil utilise un loader / une surcouche (donc pas
// du Minecraft "vanilla" pur) : OptiFine, Iris, Forge, Fabric, etc.
const NON_VANILLA_KEYWORDS = [
  'forge', 'fabric', 'neoforge', 'quilt', 'optifine', 'iris', 'sodium', 'rift', 'liteloader', 'modpack',
];

/**
 * Classe un profil non-modpack : 'vanilla' pour du Minecraft pur, 'other' pour
 * tout ce qui embarque un loader/surcouche (OptiFine, Iris, Fabric, Forge...).
 */
function classifyNonModpackKind(pr) {
  const type = String(pr.type || '').toLowerCase();
  if (type === 'latest-release' || type === 'latest-snapshot') return 'vanilla';

  const id = String(pr.lastVersionId || '').toLowerCase();
  if (NON_VANILLA_KEYWORDS.some((k) => id.includes(k))) return 'other';

  // Un id de version vanilla commence par un chiffre (1.20.1, 24w14a, 1.21-rc1...).
  if (/^\d/.test(id)) return 'vanilla';

  return 'other';
}

/** Liste tous les profils du launcher officiel (enrichis si ce sont des modpacks). */
function listProfiles() {
  const mcDir = getMinecraftDir();
  const installed = !fs.existsSync(mcDir) ? false : true;
  const data = readLauncherProfiles();
  const profiles = [];

  for (const key of Object.keys(data.profiles || {})) {
    const pr = data.profiles[key] || {};
    const info = pr.gameDir ? detectModpackInfo(pr.gameDir) : null;
    const kind = info ? 'modpack' : classifyNonModpackKind(pr);
    profiles.push({
      key,
      name: pr.name || null, // le renderer affichera « Profil par défaut » si null
      icon: pr.icon || null,
      lastVersionId: pr.lastVersionId || null,
      gameDir: pr.gameDir || null,
      type: pr.type || 'custom',
      isModpack: !!info,
      kind, // 'modpack' | 'vanilla' | 'other'
      modpackSource: info ? info.source : null,
      modpack: info
        ? { modId: info.modId, fileId: info.fileId, mcVersion: info.mcVersion, loader: info.loader, loaderVersion: info.loaderVersion }
        : null,
    });
  }

  // Tri : modpacks d'abord, puis alphabétique.
  profiles.sort((a, b) => {
    if (a.isModpack !== b.isModpack) return a.isModpack ? -1 : 1;
    return String(a.name || '').localeCompare(String(b.name || ''));
  });

  return { ok: true, minecraftDir: mcDir, minecraftInstalled: installed, profiles };
}

// ---- Jouer / désinstaller ----

function findMinecraftLauncherExe() {
  const pf86 = process.env['ProgramFiles(x86)'];
  const pf = process.env.ProgramFiles;
  const pfw = process.env.ProgramW6432;
  const local = process.env.LOCALAPPDATA;
  const candidates = [
    pf86 && path.join(pf86, 'Minecraft Launcher', 'MinecraftLauncher.exe'),
    pf && path.join(pf, 'Minecraft Launcher', 'MinecraftLauncher.exe'),
    pfw && path.join(pfw, 'Minecraft Launcher', 'MinecraftLauncher.exe'),
    local && path.join(local, 'Programs', 'Minecraft Launcher', 'MinecraftLauncher.exe'),
    pf86 && path.join(pf86, 'Minecraft', 'MinecraftLauncher.exe'),
    pf && path.join(pf, 'Minecraft', 'MinecraftLauncher.exe'),
    // Version Microsoft Store : alias d'exécution.
    local && path.join(local, 'Microsoft', 'WindowsApps', 'MinecraftLauncher.exe'),
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch (e) {
      /* ignore */
    }
  }
  return null;
}

/**
 * « Jouer » : sélectionne le profil (en actualisant lastUsed pour que le
 * launcher officiel le pré-sélectionne à l'ouverture) puis lance le launcher.
 * Le launcher officiel ne fournit pas d'API stable pour démarrer directement
 * une partie ; on l'ouvre donc sur le bon profil.
 */
function playProfile(profileKey) {
  const p = getProfilesPath();
  const data = readLauncherProfiles();
  if (!data.profiles || !data.profiles[profileKey]) {
    return { ok: false, error: i18n.t('mcl.profileNotFound') };
  }

  data.profiles[profileKey].lastUsed = new Date().toISOString();
  try {
    backup(p);
    fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    return { ok: false, error: i18n.t('mcl.profileUpdateFail', { error: e.message }) };
  }

  // Le lancement effectif est fait côté main via shell.openPath (plus fiable
  // que spawn pour une appli GUI / un alias Microsoft Store). On renvoie juste
  // le chemin trouvé (ou null).
  return { ok: true, exe: findMinecraftLauncherExe() };
}

/**
 * Désinstalle un modpack : retire l'entrée du profil et supprime le dossier
 * d'instance. Par sécurité, on ne supprime que des dossiers reconnus comme
 * instances (marqueur ou minecraftinstance.json, ou situés dans gg-instances)
 * et jamais le .minecraft lui-même.
 */
function uninstallProfile(profileKey) {
  const p = getProfilesPath();
  const data = readLauncherProfiles();
  const pr = data.profiles && data.profiles[profileKey];
  if (!pr) return { ok: false, error: i18n.t('mcl.profileNotFound') };

  const gameDir = pr.gameDir;

  // Retrait de l'entrée de profil.
  delete data.profiles[profileKey];
  try {
    backup(p);
    fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    return { ok: false, error: i18n.t('mcl.profilesWriteFail', { error: e.message }) };
  }

  // Suppression du dossier d'instance, avec garde-fous.
  let folderRemoved = false;
  if (gameDir) {
    const resolved = path.resolve(gameDir);
    const mcRoot = path.resolve(getMinecraftDir());
    const instancesRoot = path.resolve(getInstancesDir());

    const isProtected = resolved === mcRoot || resolved === path.resolve(mcRoot, '..') || resolved.length < 4;
    const underInstances = resolved.startsWith(instancesRoot + path.sep);
    const looksLikeInstance =
      fs.existsSync(path.join(resolved, MARKER)) || fs.existsSync(path.join(resolved, 'minecraftinstance.json'));

    if (!isProtected && (underInstances || looksLikeInstance)) {
      try {
        fs.rmSync(resolved, { recursive: true, force: true });
        folderRemoved = true;
      } catch (e) {
        return { ok: true, folderRemoved: false, warning: i18n.t('mcl.uninstallFolderFail', { error: e.message }), gameDir };
      }
    } else {
      return { ok: true, folderRemoved: false, warning: i18n.t('mcl.uninstallFolderSkipped', { dir: gameDir }), gameDir };
    }
  }

  return { ok: true, folderRemoved, gameDir };
}

// ---- Lancement rapide (hors-ligne, sans le launcher officiel) ----
//
// Reconstruit la commande `java` à partir des fichiers DÉJÀ installés dans
// .minecraft (JSON de version, librairies, natives, assets). Aucun compte
// Microsoft n'est utilisé : on lance en mode hors-ligne (pseudo local, pas de
// serveurs en ligne premium). Cible Windows (l'app est Windows-only).

const OS_NAME = 'windows';
const CP_SEP = ';';
const NATIVE_ARCH = process.arch === 'ia32' ? '32' : '64';

// Charge un JSON de version brut : versions/<id>/<id>.json.
function loadVersionJsonRaw(id) {
  const p = path.join(getVersionsDir(), id, id + '.json');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// Résout un JSON de version en fusionnant l'héritage (Forge/NeoForge/Fabric
// héritent d'une version vanilla via « inheritsFrom »).
function resolveVersionJson(id, seen) {
  seen = seen || new Set();
  if (seen.has(id)) throw new Error('Boucle d\'héritage de version : ' + id);
  seen.add(id);

  const j = loadVersionJsonRaw(id);
  if (j.inheritsFrom) {
    const parent = resolveVersionJson(j.inheritsFrom, seen);
    return mergeVersions(parent, j);
  }
  if (!j.jar) j.jar = id; // le jar client vanilla est versions/<jar>/<jar>.jar
  return j;
}

function mergeVersions(parent, child) {
  const merged = Object.assign({}, parent);
  merged.id = child.id || parent.id;
  merged.mainClass = child.mainClass || parent.mainClass;
  merged.jar = parent.jar || parent.id; // toujours le jar client vanilla
  merged.assetIndex = child.assetIndex || parent.assetIndex;
  merged.assets = child.assets || parent.assets;
  merged.type = child.type || parent.type;
  merged.javaVersion = child.javaVersion || parent.javaVersion;
  merged.libraries = [].concat(child.libraries || [], parent.libraries || []);

  if (parent.arguments || child.arguments) {
    merged.arguments = {
      game: [].concat(
        (parent.arguments && parent.arguments.game) || [],
        (child.arguments && child.arguments.game) || []
      ),
      jvm: [].concat(
        (parent.arguments && parent.arguments.jvm) || [],
        (child.arguments && child.arguments.jvm) || []
      ),
    };
  }
  merged.minecraftArguments = child.minecraftArguments || parent.minecraftArguments;
  return merged;
}

// Évalue les règles allow/disallow d'une librairie ou d'un argument.
// Les règles « features » (mode démo, résolution custom) ne sont jamais
// activées : on ignore donc les entrées qui en dépendent.
function ruleAllows(rules) {
  if (!rules || rules.length === 0) return true;
  let allow = false;
  for (const r of rules) {
    let matches = true;
    if (r.features) matches = false;
    if (matches && r.os && r.os.name && r.os.name !== OS_NAME) matches = false;
    if (matches) allow = r.action === 'allow';
  }
  return allow;
}

// Chemin d'une librairie à partir de ses coordonnées Maven (group:artifact:version[:classifier]).
function mavenToPath(name) {
  const parts = name.split(':');
  const group = parts[0].replace(/\./g, '/');
  const artifact = parts[1];
  const version = parts[2];
  const classifier = parts[3];
  const file = artifact + '-' + version + (classifier ? '-' + classifier : '') + '.jar';
  return path.join(getMinecraftDir(), 'libraries', group.split('/').join(path.sep), artifact, version, file);
}

function isNativeName(name) {
  const parts = name.split(':');
  return parts.length >= 4 && /^natives-/.test(parts[3]);
}

// Construit le classpath et la liste des jars de natives à extraire.
function collectLibraries(version) {
  const classpath = [];
  const nativeJars = [];
  const libDir = path.join(getMinecraftDir(), 'libraries');

  for (const lib of version.libraries || []) {
    if (!ruleAllows(lib.rules)) continue;

    // Natives « legacy » (pré-1.13) : champ natives + downloads.classifiers.
    if (lib.natives && lib.natives[OS_NAME]) {
      const classifier = String(lib.natives[OS_NAME]).replace(/\$\{arch\}/g, NATIVE_ARCH);
      const cl = lib.downloads && lib.downloads.classifiers && lib.downloads.classifiers[classifier];
      let jar = null;
      if (cl && cl.path) jar = path.join(libDir, cl.path.split('/').join(path.sep));
      else jar = mavenToPath(lib.name + ':' + classifier);
      if (jar && fs.existsSync(jar)) nativeJars.push(jar);
      // Certaines libs legacy fournissent aussi un artefact principal à mettre au classpath.
      const art0 = lib.downloads && lib.downloads.artifact;
      if (art0 && art0.path) {
        const p0 = path.join(libDir, art0.path.split('/').join(path.sep));
        if (fs.existsSync(p0)) classpath.push(p0);
      }
      continue;
    }

    const art = lib.downloads && lib.downloads.artifact;
    let p = null;
    if (art && art.path) p = path.join(libDir, art.path.split('/').join(path.sep));
    else if (lib.name) p = mavenToPath(lib.name);
    if (!p || !fs.existsSync(p)) continue;

    // Natives « modernes » (1.13+) : entrées de librairie dont le classifier
    // est natives-windows → à extraire (elles ne contiennent que des .dll).
    const nativeByPath = art && art.path && /natives-/.test(art.path);
    if (isNativeName(lib.name) || nativeByPath) nativeJars.push(p);
    else classpath.push(p);
  }

  return { classpath, nativeJars };
}

// Extrait les .dll des jars de natives vers un dossier temporaire (via PowerShell,
// sans dépendance npm).
function extractNatives(nativeJars, nativesDir) {
  return new Promise((resolve) => {
    try {
      fs.rmSync(nativesDir, { recursive: true, force: true });
    } catch (e) { /* ignore */ }
    fs.mkdirSync(nativesDir, { recursive: true });

    if (!nativeJars.length) return resolve({ ok: true });

    const jarsLiteral = nativeJars.map((j) => "'" + j.replace(/'/g, "''") + "'").join(",\n");
    const script =
      'Add-Type -AssemblyName System.IO.Compression.FileSystem | Out-Null\n' +
      "$dest = '" + nativesDir.replace(/'/g, "''") + "'\n" +
      '$jars = @(' + jarsLiteral + ')\n' +
      'foreach ($jar in $jars) {\n' +
      '  if (-not (Test-Path $jar)) { continue }\n' +
      '  try {\n' +
      '    $zip = [System.IO.Compression.ZipFile]::OpenRead($jar)\n' +
      '    foreach ($e in $zip.Entries) {\n' +
      "      if ($e.Name -match '\\.dll$') {\n" +
      '        $out = Join-Path $dest $e.Name\n' +
      '        [System.IO.Compression.ZipFileExtensions]::ExtractToFile($e, $out, $true)\n' +
      '      }\n' +
      '    }\n' +
      '    $zip.Dispose()\n' +
      '  } catch { }\n' +
      '}\n';

    const scriptPath = path.join(os.tmpdir(), 'gg-natives-' + Date.now() + '.ps1');
    try {
      fs.writeFileSync(scriptPath, script, 'utf8');
    } catch (e) {
      return resolve({ ok: false, error: e.message });
    }

    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
      { windowsHide: true, timeout: 120000 },
      (err) => {
        try { fs.unlinkSync(scriptPath); } catch (e) { /* ignore */ }
        if (err) return resolve({ ok: false, error: err.message });
        resolve({ ok: true });
      }
    );
  });
}

// UUID hors-ligne, identique à celui calculé par Minecraft :
// UUID v3 (MD5) de « OfflinePlayer:<pseudo> ».
function offlineUuid(name) {
  const md5 = crypto.createHash('md5').update('OfflinePlayer:' + name, 'utf8').digest();
  md5[6] = (md5[6] & 0x0f) | 0x30;
  md5[8] = (md5[8] & 0x3f) | 0x80;
  const h = md5.toString('hex');
  return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
}

// Composants de runtime Java installés par le launcher officiel, par version majeure.
function componentsForMajor(major) {
  const map = {
    8: ['jre-legacy'],
    16: ['java-runtime-alpha'],
    17: ['java-runtime-gamma', 'java-runtime-beta', 'java-runtime-gamma-snapshot'],
    21: ['java-runtime-delta'],
  };
  return map[major] || null;
}

// Cherche un javaw.exe adapté : d'abord dans les runtimes du launcher officiel
// (pour coller à la version majeure requise), sinon sur le PATH.
async function resolveJava(version) {
  const major = version.javaVersion && version.javaVersion.majorVersion;
  const wanted = componentsForMajor(major);

  const roots = [];
  const local = process.env.LOCALAPPDATA;
  const pf86 = process.env['ProgramFiles(x86)'];
  const pf = process.env.ProgramFiles;
  if (local) {
    roots.push(path.join(local, 'Packages', 'Microsoft.4297127D64EC6_8wekyb3d8bbwe', 'LocalCache', 'Local', 'runtime'));
  }
  if (pf86) roots.push(path.join(pf86, 'Minecraft Launcher', 'runtime'));
  if (pf) roots.push(path.join(pf, 'Minecraft Launcher', 'runtime'));
  roots.push(path.join(getMinecraftDir(), 'runtime'));

  const found = [];
  for (const root of roots) {
    for (const comp of safeReaddir(root)) {
      const compDir = path.join(root, comp);
      for (const plat of safeReaddir(compDir)) {
        const candidates = [
          path.join(compDir, plat, comp, 'bin', 'javaw.exe'),
          path.join(compDir, plat, 'bin', 'javaw.exe'),
        ];
        for (const c of candidates) {
          try { if (fs.existsSync(c)) found.push({ comp, javaw: c }); } catch (e) { /* ignore */ }
        }
      }
    }
  }

  if (wanted) {
    const match = found.find((f) => wanted.includes(f.comp));
    if (match) return match.javaw;
  }
  if (found.length) return found[0].javaw;

  const hasJava = await detectJava();
  return hasJava ? 'javaw' : null;
}

function substitute(str, ph) {
  return String(str).replace(/\$\{(\w+)\}/g, (m, k) => (ph[k] != null ? ph[k] : m));
}

function processArgList(list, ph) {
  const out = [];
  for (const item of list || []) {
    if (typeof item === 'string') {
      out.push(substitute(item, ph));
    } else if (item && typeof item === 'object') {
      if (!ruleAllows(item.rules)) continue;
      const val = item.value;
      if (Array.isArray(val)) val.forEach((v) => out.push(substitute(v, ph)));
      else if (typeof val === 'string') out.push(substitute(val, ph));
    }
  }
  return out;
}

/**
 * Lance directement un profil en mode hors-ligne, sans passer par le launcher
 * officiel. Réutilise les fichiers déjà installés dans .minecraft.
 * @returns { ok, playerName } ou { ok:false, error }
 */
async function quickLaunchProfile(profileKey, opts) {
  opts = opts || {};
  const data = readLauncherProfiles();
  const pr = data.profiles && data.profiles[profileKey];
  if (!pr) return { ok: false, error: 'profileNotFound' };

  const versionId = pr.lastVersionId;
  if (!versionId) return { ok: false, error: 'noVersion' };

  const gameDir = pr.gameDir || getMinecraftDir();

  let version;
  try {
    version = resolveVersionJson(versionId);
  } catch (e) {
    return { ok: false, error: 'versionJson', versionId, detail: e.message };
  }

  const clientJar = path.join(getVersionsDir(), version.jar, version.jar + '.jar');
  if (!fs.existsSync(clientJar)) {
    return { ok: false, error: 'clientJar', clientJar };
  }

  const javaPath = await resolveJava(version);
  if (!javaPath) return { ok: false, error: 'noJava' };

  const { classpath, nativeJars } = collectLibraries(version);
  classpath.push(clientJar);

  const nativesDir = path.join(os.tmpdir(), 'gg-natives-' + versionId.replace(/[^a-z0-9]/gi, '_'));
  const nat = await extractNatives(nativeJars, nativesDir);
  if (!nat.ok) return { ok: false, error: 'natives', detail: nat.error };

  const assetsDir = path.join(getMinecraftDir(), 'assets');
  const assetIndex = (version.assetIndex && version.assetIndex.id) || version.assets || 'legacy';
  const playerName =
    (opts.playerName && String(opts.playerName).trim()) ||
    appSettings.getSettings().offlinePlayerName ||
    (os.userInfo().username || 'Player');
  const uuid = offlineUuid(playerName);

  const ph = {
    auth_player_name: playerName,
    version_name: versionId,
    game_directory: gameDir,
    assets_root: assetsDir,
    game_assets: assetsDir,
    assets_index_name: assetIndex,
    auth_uuid: uuid,
    auth_access_token: '0',
    auth_session: 'token:0:' + uuid,
    clientid: '',
    auth_xuid: '',
    user_type: 'legacy',
    user_properties: '{}',
    version_type: version.type || 'release',
    natives_directory: nativesDir,
    launcher_name: 'G-GameManager',
    launcher_version: '1.0',
    classpath: classpath.join(CP_SEP),
    library_directory: path.join(getMinecraftDir(), 'libraries'),
    classpath_separator: CP_SEP,
  };

  // Arguments JVM
  let jvmArgs;
  if (version.arguments && version.arguments.jvm) {
    jvmArgs = processArgList(version.arguments.jvm, ph);
  } else {
    jvmArgs = ['-Djava.library.path=' + nativesDir, '-cp', ph.classpath];
  }
  jvmArgs.unshift('-Dminecraft.launcher.brand=G-GameManager');

  // Mémoire : arguments Java du profil, sinon défaut raisonnable.
  const userJavaArgs = (pr.javaArgs ? String(pr.javaArgs) : '').trim();
  if (userJavaArgs) jvmArgs = jvmArgs.concat(userJavaArgs.split(/\s+/));
  else if (!jvmArgs.some((a) => /^-Xmx/.test(a))) jvmArgs.push('-Xmx2G');

  // Arguments du jeu
  let gameArgs;
  if (version.arguments && version.arguments.game) {
    gameArgs = processArgList(version.arguments.game, ph);
  } else if (version.minecraftArguments) {
    gameArgs = version.minecraftArguments.split(/\s+/).map((a) => substitute(a, ph));
  } else {
    gameArgs = [];
  }

  const fullArgs = jvmArgs.concat([version.mainClass], gameArgs);

  // Journalise la commande complète (utile en cas de problème de lancement).
  try {
    fs.writeFileSync(
      path.join(os.tmpdir(), 'gg-quicklaunch.log'),
      'java: ' + javaPath + '\ncwd: ' + gameDir + '\n\n' + fullArgs.join('\n'),
      'utf8'
    );
  } catch (e) { /* best-effort */ }

  let child;
  try {
    child = spawn(javaPath, fullArgs, { cwd: gameDir, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    return { ok: false, error: 'spawn', detail: e.message, java: javaPath };
  }

  // Fenêtre de diagnostic : on écoute une éventuelle erreur de spawn ou un crash
  // immédiat (mauvaise version de Java, librairie manquante…) pour la remonter à
  // l'utilisateur. Si le process tourne toujours après le délai, c'est un succès.
  return await new Promise((resolve) => {
    let settled = false;
    let out = '';
    // On garde beaucoup plus de sortie : le message d'exception utile est en
    // HAUT de la pile, donc conserver seulement la fin le masquerait.
    const capture = (d) => { out += d.toString(); if (out.length > 200000) out = out.slice(-200000); };
    if (child.stdout) child.stdout.on('data', capture); // draine en continu (évite le blocage du tuyau)
    if (child.stderr) child.stderr.on('data', capture);

    // Extrait la ou les lignes réellement informatives d'une sortie Java :
    // la première ligne d'exception/erreur (hors « at … ») et son éventuel « Caused by ».
    function meaningfulError(full) {
      const lines = full.split(/\r?\n/);
      const picks = [];
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        if (/^\s+at\s/.test(l)) continue;
        if (/(Exception|Error|Caused by|Could not|Unable to|FATAL|failed|introuvable)/i.test(l) && l.trim()) {
          picks.push(l.trim());
          if (picks.length >= 4) break;
        }
      }
      if (picks.length) return picks.join('\n');
      // repli : premières lignes non vides
      return lines.filter((l) => l.trim()).slice(0, 6).join('\n');
    }

    function writeOutputLog(full) {
      const p = path.join(os.tmpdir(), 'gg-quicklaunch-output.log');
      try { fs.writeFileSync(p, full, 'utf8'); } catch (e) { /* ignore */ }
      return p;
    }

    child.on('error', (e) => {
      if (settled) return;
      settled = true;
      resolve({ ok: false, error: 'spawn', detail: e.message, java: javaPath });
    });

    child.on('exit', (code) => {
      if (settled) return;
      settled = true;
      if (code === 0) {
        resolve({ ok: true, playerName, java: javaPath });
      } else {
        const full = out.trim();
        const logPath = writeOutputLog(full);
        const head = meaningfulError(full);
        resolve({
          ok: false,
          error: 'spawn',
          detail: 'code ' + code + (head ? ' — ' + head : '') + '\n[log complet : ' + logPath + ']',
          java: javaPath,
        });
      }
    });

    setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.unref(); } catch (e) { /* ignore */ }
      resolve({ ok: true, playerName, java: javaPath });
    }, 6000);
  });
}

module.exports = {
  getMinecraftDir,
  getInstancesDir,
  getVersionsDir,
  slugify,
  detectJava,
  installLoader,
  upsertProfile,
  listProfiles,
  listInstalledModpacks,
  detectModpackInfo,
  readCurseForgeInstance,
  readInstanceMarker,
  writeInstanceMarker,
  playProfile,
  quickLaunchProfile,
  uninstallProfile,
  findMinecraftLauncherExe,
  downloadToFile,
  httpsGetText,
  MARKER,
};
