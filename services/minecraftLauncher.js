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
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { execFile, spawn } = require('child_process');
const { app } = require('electron');
const appSettings = require('./appSettings');

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
    return { ok: false, error: 'Impossible de récupérer le profil Fabric (' + (res.error || 'réponse invalide') + ').' };
  }

  const versionId = res.data.id; // ex: "fabric-loader-0.15.7-1.20.1"
  const dir = path.join(getVersionsDir(), versionId);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, versionId + '.json'), JSON.stringify(res.data, null, 2), 'utf8');
  } catch (e) {
    return { ok: false, error: 'Écriture du profil Fabric échouée : ' + e.message };
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
    return { ok: false, error: "Téléchargement de l'installeur " + kind + ' échoué : ' + e.message };
  }

  const before = new Set(safeReaddir(getVersionsDir()));
  const run = await runInstaller(jarPath, getMinecraftDir());
  if (!run.ok) {
    return { ok: false, error: "L'installeur " + kind + ' a échoué : ' + run.error };
  }

  // Détermine l'id de version nouvellement créé (diff avant/après, sinon match).
  const after = safeReaddir(getVersionsDir());
  const created = after.find((n) => !before.has(n) && matchPredicate(n));
  const versionId = created || findNewestVersionIdMatching(matchPredicate);
  if (!versionId) {
    return { ok: false, error: "Installeur " + kind + ' terminé mais aucune version détectée dans versions/.' };
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
    if (!res.ok || !res.data || !res.data.id) return { ok: false, error: 'Profil Quilt indisponible.' };
    const versionId = res.data.id;
    const dir = path.join(getVersionsDir(), versionId);
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, versionId + '.json'), JSON.stringify(res.data, null, 2), 'utf8');
    } catch (e) {
      return { ok: false, error: 'Écriture du profil Quilt échouée : ' + e.message };
    }
    return { ok: true, versionId };
  }

  // Forge / NeoForge nécessitent Java (exécution de l'installeur officiel).
  const hasJava = await detectJava();
  if (!hasJava) {
    return {
      ok: false,
      needsJava: true,
      error:
        "Java est introuvable sur le PATH. L'installation de " + name +
        ' nécessite Java (le même que celui utilisé pour jouer). Installe Java puis réessaie.',
    };
  }

  if (name === 'forge') return installForge(mcVersion, version, tmpDir);
  if (name === 'neoforge') return installNeoForge(version, tmpDir);

  return { ok: false, error: 'Loader non pris en charge : ' + name };
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
    return { ok: false, error: "Dossier .minecraft introuvable (" + getMinecraftDir() + "). Le launcher Minecraft officiel est-il installé ?" };
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
    return { ok: false, error: "Écriture de launcher_profiles.json échouée : " + e.message };
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
      name: pr.name || '(sans nom)',
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
    return a.name.localeCompare(b.name);
  });

  return { ok: true, minecraftDir: mcDir, minecraftInstalled: installed, profiles };
}

// ---- Jouer / désinstaller ----

function findMinecraftLauncherExe() {
  const candidates = [
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Minecraft Launcher', 'MinecraftLauncher.exe'),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Minecraft Launcher', 'MinecraftLauncher.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Minecraft Launcher', 'MinecraftLauncher.exe'),
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Minecraft', 'MinecraftLauncher.exe'),
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
    return { ok: false, error: 'Profil introuvable.' };
  }

  data.profiles[profileKey].lastUsed = new Date().toISOString();
  try {
    backup(p);
    fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    return { ok: false, error: 'Impossible de mettre à jour le profil : ' + e.message };
  }

  const exe = findMinecraftLauncherExe();
  if (!exe) {
    return {
      ok: true,
      launched: false,
      message: "Profil pré-sélectionné, mais le launcher Minecraft officiel est introuvable. Ouvre-le manuellement pour jouer.",
    };
  }

  try {
    const child = spawn(exe, [], { detached: true, stdio: 'ignore' });
    child.unref();
  } catch (e) {
    return { ok: true, launched: false, message: "Profil pré-sélectionné, mais le lancement du launcher a échoué : " + e.message };
  }
  return { ok: true, launched: true };
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
  if (!pr) return { ok: false, error: 'Profil introuvable.' };

  const gameDir = pr.gameDir;

  // Retrait de l'entrée de profil.
  delete data.profiles[profileKey];
  try {
    backup(p);
    fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    return { ok: false, error: 'Écriture de launcher_profiles.json échouée : ' + e.message };
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
        return { ok: true, folderRemoved: false, warning: "Profil retiré, mais le dossier n'a pas pu être supprimé : " + e.message, gameDir };
      }
    } else {
      return { ok: true, folderRemoved: false, warning: "Profil retiré. Le dossier de jeu n'a pas été supprimé automatiquement par précaution : " + gameDir, gameDir };
    }
  }

  return { ok: true, folderRemoved, gameDir };
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
  uninstallProfile,
  findMinecraftLauncherExe,
  downloadToFile,
  httpsGetText,
  MARKER,
};
