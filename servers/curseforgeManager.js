'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { app } = require('electron');
const minecraftManager = require('./minecraftManager');
const launcher = require('../services/minecraftLauncher');

// ---- Constantes API CurseForge ----
// Documentation : https://docs.curseforge.com/rest-api/
const API_HOST = 'api.curseforge.com';
const GAME_ID_MINECRAFT = 432;
const CLASS_ID_MODPACKS = 4471; // classe "Modpacks" pour Minecraft
const PAGE_SIZE = 10; // 10 modpacks par page (façon ludothèque)

// Clé API intégrée directement dans le code (demandé). À partir du 16/07/2026,
// CurseForge exige une clé valide même sur le CDN de téléchargement : on l'envoie
// donc aussi bien sur l'API que sur les téléchargements de fichiers.
const API_KEY = '$2a$10$kCNdAgD4cCujL/7AvxTEXOqh5S0dn9ca2MrikBrEqOp16JsIld8KW';

function getApiKey() {
  return API_KEY;
}

// ---- Diffusion de la progression vers le renderer ----

let progressBroadcaster = null;
function setProgressBroadcaster(fn) {
  progressBroadcaster = fn;
}
function emitProgress(payload) {
  if (progressBroadcaster) {
    try {
      progressBroadcaster(payload);
    } catch (e) {
      /* best-effort */
    }
  }
}

// ---- Appels API JSON ----

function apiGetJson(pathAndQuery) {
  return new Promise((resolve) => {
    const options = {
      host: API_HOST,
      path: pathAndQuery,
      method: 'GET',
      headers: { Accept: 'application/json', 'x-api-key': API_KEY },
    };

    const req = https.request(options, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (raw += chunk));
      res.on('end', () => {
        if (res.statusCode === 401 || res.statusCode === 403) {
          resolve({ ok: false, status: res.statusCode, error: 'Clé API CurseForge invalide ou non autorisée (HTTP ' + res.statusCode + ').' });
          return;
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          resolve({ ok: false, status: res.statusCode, error: 'Réponse inattendue de CurseForge (HTTP ' + res.statusCode + ').' });
          return;
        }
        try {
          resolve({ ok: true, status: res.statusCode, data: JSON.parse(raw) });
        } catch (e) {
          resolve({ ok: false, status: res.statusCode, error: 'Réponse CurseForge illisible (JSON invalide).' });
        }
      });
    });

    req.on('error', (err) => resolve({ ok: false, status: 0, error: 'Échec de la connexion à CurseForge : ' + err.message }));
    req.setTimeout(20000, () => req.destroy(new Error('délai dépassé')));
    req.end();
  });
}

// ---- Détection MC version / loader depuis les gameVersions d'un fichier ----

const KNOWN_LOADERS = ['neoforge', 'forge', 'fabric', 'quilt'];

function detectVersionInfo(gameVersions) {
  const list = Array.isArray(gameVersions) ? gameVersions : [];
  const mcVersion = list.find((v) => /^\d+\.\d+/.test(v)) || null;
  let loaderName = null;
  for (const v of list) {
    const low = String(v).toLowerCase();
    if (KNOWN_LOADERS.includes(low)) {
      loaderName = low;
      break;
    }
  }
  return { mcVersion, loaderName };
}

// ---- Normalisation d'un modpack pour la grille ----

function normalizeModpack(mod) {
  const latestFiles = Array.isArray(mod.latestFiles) ? mod.latestFiles : [];
  let mainFile = latestFiles.find((f) => f.id === mod.mainFileId);
  if (!mainFile && latestFiles.length > 0) mainFile = latestFiles.slice().sort((a, b) => b.id - a.id)[0];

  const serverPackFileId = mainFile && mainFile.serverPackFileId ? mainFile.serverPackFileId : null;
  const info = mainFile ? detectVersionInfo(mainFile.gameVersions) : { mcVersion: null, loaderName: null };

  return {
    id: mod.id,
    name: mod.name,
    summary: mod.summary || '',
    thumbnailUrl: mod.logo ? mod.logo.thumbnailUrl || mod.logo.url || null : null,
    downloadCount: mod.downloadCount || 0,
    categories: Array.isArray(mod.categories) ? mod.categories.map((c) => c.name).filter(Boolean) : [],
    mainFileId: mainFile ? mainFile.id : null,
    mainFileName: mainFile ? mainFile.fileName || mainFile.displayName : null,
    hasServerPack: !!serverPackFileId,
    serverPackFileId,
    gameVersion: info.mcVersion,
    loaderName: info.loaderName,
  };
}

// ---- Recherche paginée ----

async function searchModpacks(opts = {}) {
  const { searchFilter = '', categoryId = null, categoryIds = null, index = 0, sortField = 2, sortOrder = 'desc' } = opts;

  const params = new URLSearchParams();
  params.set('gameId', String(GAME_ID_MINECRAFT));
  params.set('classId', String(CLASS_ID_MODPACKS));
  params.set('pageSize', String(PAGE_SIZE));
  params.set('index', String(Math.max(0, index)));
  params.set('sortField', String(sortField));
  params.set('sortOrder', sortOrder);
  if (searchFilter && searchFilter.trim()) params.set('searchFilter', searchFilter.trim());
  // Filtre par types : plusieurs catégories possibles (paramètre categoryIds,
  // tableau JSON). On garde categoryId (unique) en repli de compatibilité.
  if (Array.isArray(categoryIds) && categoryIds.length > 0) {
    params.set('categoryIds', JSON.stringify(categoryIds.map((c) => Number(c)).filter(Boolean)));
  } else if (categoryId) {
    params.set('categoryId', String(categoryId));
  }

  const result = await apiGetJson('/v1/mods/search?' + params.toString());
  if (!result.ok) return { ok: false, error: result.error };

  const body = result.data || {};
  const modpacks = (body.data || []).map(normalizeModpack);
  const pagination = body.pagination || {};
  const totalCount = Math.min(pagination.totalCount || 0, 10000);

  return {
    ok: true,
    modpacks,
    pagination: {
      index: pagination.index != null ? pagination.index : index,
      pageSize: PAGE_SIZE,
      resultCount: pagination.resultCount || modpacks.length,
      totalCount,
    },
  };
}

// ---- Liste des versions (fichiers) d'un modpack ----

async function getModpackFiles(modId) {
  // On récupère les fichiers les plus récents (l'API pagine ; 50 suffisent
  // largement pour proposer un choix de versions).
  const res = await apiGetJson('/v1/mods/' + modId + '/files?pageSize=50&index=0');
  if (!res.ok) return { ok: false, error: res.error };

  const files = (res.data && res.data.data ? res.data.data : [])
    // On ne garde que des fichiers réels ; certains "serverpack" apparaissent
    // aussi ici — on les distingue via isServerPack pour ne pas les proposer
    // comme version installable de profil.
    .filter((f) => !f.isServerPack)
    .map((f) => {
      const info = detectVersionInfo(f.gameVersions);
      return {
        id: f.id,
        displayName: f.displayName || f.fileName,
        fileName: f.fileName,
        mcVersion: info.mcVersion,
        loaderName: info.loaderName,
        serverPackFileId: f.serverPackFileId || null,
        releaseType: f.releaseType, // 1=release, 2=beta, 3=alpha
        fileDate: f.fileDate || null,
      };
    })
    // Tri du plus récent au plus ancien (id décroissant).
    .sort((a, b) => b.id - a.id);

  return { ok: true, files };
}

// ---- Catégories (filtre "type de modpack") ----

async function getCategories() {
  const result = await apiGetJson('/v1/categories?gameId=' + GAME_ID_MINECRAFT + '&classId=' + CLASS_ID_MODPACKS);
  if (!result.ok) return { ok: false, error: result.error };

  const cats = (result.data && result.data.data ? result.data.data : [])
    .filter((c) => !c.isClass)
    .map((c) => ({ id: c.id, name: c.name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { ok: true, categories: cats };
}

// ---- Résolution d'URL de téléchargement d'un fichier ----

async function resolveDownloadInfo(modId, fileId) {
  const fileRes = await apiGetJson('/v1/mods/' + modId + '/files/' + fileId);
  let fileName = null;
  let downloadUrl = null;
  if (fileRes.ok && fileRes.data && fileRes.data.data) {
    fileName = fileRes.data.data.fileName || fileRes.data.data.displayName || null;
    downloadUrl = fileRes.data.data.downloadUrl || null;
  }
  if (!downloadUrl) {
    const urlRes = await apiGetJson('/v1/mods/' + modId + '/files/' + fileId + '/download-url');
    if (urlRes.ok && urlRes.data && urlRes.data.data) downloadUrl = urlRes.data.data;
  }
  return { fileName, downloadUrl };
}

// ---- Téléchargement HTTP vers fichier (avec clé API sur le CDN) ----

function httpsDownloadToFile(url, destFile, onProgress, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    function doGet(currentUrl, redirectsLeft) {
      let parsed;
      try {
        parsed = new URL(currentUrl);
      } catch (e) {
        reject(new Error('URL de téléchargement invalide.'));
        return;
      }
      const options = { method: 'GET', headers: { 'x-api-key': API_KEY } };
      https
        .get(currentUrl, options, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectsLeft > 0) {
            res.resume();
            doGet(new URL(res.headers.location, parsed).href, redirectsLeft - 1);
            return;
          }
          if (res.statusCode !== 200) {
            res.resume();
            reject(new Error('Échec du téléchargement (HTTP ' + res.statusCode + ').'));
            return;
          }
          const totalBytes = parseInt(res.headers['content-length'] || '0', 10) || 0;
          let received = 0;
          const out = fs.createWriteStream(destFile);
          res.on('data', (chunk) => {
            received += chunk.length;
            if (onProgress) onProgress(received, totalBytes);
          });
          res.pipe(out);
          out.on('finish', () => out.close(() => resolve()));
          out.on('error', (err) => reject(err));
        })
        .on('error', (err) => reject(err));
    }
    doGet(url, maxRedirects);
  });
}

// ---- Extraction ZIP via PowerShell (natif Windows 10+) ----

function extractZip(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    const escZip = zipPath.replace(/'/g, "''");
    const escDest = destDir.replace(/'/g, "''");
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
        `Expand-Archive -LiteralPath '${escZip}' -DestinationPath '${escDest}' -Force`],
      { windowsHide: true, timeout: 300000 },
      (err) => (err ? reject(err) : resolve())
    );
  });
}

// ---- Utilitaires fichiers ----

function sanitizeFolderName(name) {
  return (
    String(name || 'modpack')
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'modpack'
  );
}

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

function makeTmpDir() {
  const dir = path.join(app.getPath('temp'), 'gg-cf-' + crypto.randomBytes(6).toString('hex'));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Aplati les dossiers "enveloppe" : beaucoup de serverpacks s'extraient dans un
 * unique sous-dossier (ex: <dest>/NomDuPack/start.ps1). On remonte alors le
 * contenu d'un cran pour que les fichiers (start.ps1, server.properties...) se
 * trouvent directement dans le dossier de destination. Répété si double emballage.
 */
function flattenSingleWrapper(dir) {
  let guard = 0;
  while (guard++ < 4) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      return;
    }
    if (entries.length === 1 && entries[0].isDirectory()) {
      const inner = path.join(dir, entries[0].name);
      let children;
      try {
        children = fs.readdirSync(inner);
      } catch (e) {
        return;
      }
      try {
        for (const child of children) {
          fs.renameSync(path.join(inner, child), path.join(dir, child));
        }
        fs.rmdirSync(inner);
      } catch (e) {
        return; // en cas d'échec de déplacement, on laisse la structure telle quelle
      }
    } else {
      break;
    }
  }
}

function rmDirSafe(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (e) {
    /* best-effort */
  }
}

// ---- Icône du profil (image du modpack en data URI) ----

async function buildIconDataUri(thumbnailUrl, tmpDir) {
  if (!thumbnailUrl) return null;
  try {
    const ext = (path.extname(new URL(thumbnailUrl).pathname) || '.png').toLowerCase();
    const iconPath = path.join(tmpDir, 'icon' + ext);
    await launcher.downloadToFile(thumbnailUrl, iconPath, { 'x-api-key': API_KEY });
    const buf = fs.readFileSync(iconPath);
    // Le launcher officiel accepte une data URI. On borne la taille pour éviter
    // un launcher_profiles.json démesuré (au-delà, on garde l'icône par défaut).
    if (buf.length > 400 * 1024) return null;
    const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.gif' ? 'image/gif' : 'image/png';
    return 'data:' + mime + ';base64,' + buf.toString('base64');
  } catch (e) {
    return null;
  }
}

// ---- Téléchargement du serverpack (vers le dossier racine des serveurs) ----

async function downloadServerPack(opts) {
  const { modId, serverPackFileId, name } = opts;
  const rootFolder = minecraftManager.getRootFolder();
  if (!rootFolder) {
    return { ok: false, error: "Aucun dossier racine Minecraft n'est configuré (onglet Serveurs Minecraft). Choisis-le d'abord." };
  }
  if (!serverPackFileId) return { ok: false, error: 'Ce modpack ne propose pas de serverpack.' };

  emitProgress({ modId, kind: 'serverpack', phase: 'resolving', received: 0, total: 0 });
  const info = await resolveDownloadInfo(modId, serverPackFileId);
  if (!info.downloadUrl) {
    return { ok: false, error: "Téléchargement du serverpack désactivé par l'auteur sur CurseForge. Téléchargement manuel requis." };
  }

  // Dossier de destination = <racine>/<nom du modpack> (un cran sous le chemin
  // choisi), pour que le serveur soit rangé dans un dossier à son nom.
  const baseName = sanitizeFolderName(name);
  let destDir = path.join(rootFolder, baseName);
  let counter = 2;
  while (fs.existsSync(destDir) && fs.readdirSync(destDir).length > 0) {
    destDir = path.join(rootFolder, baseName + ' (' + counter + ')');
    counter++;
  }
  fs.mkdirSync(destDir, { recursive: true });

  // Le zip est téléchargé dans un dossier temporaire (hors destination) pour que
  // l'aplatissement ne voie que le contenu réellement extrait.
  const fileName = info.fileName || 'serverpack.zip';
  const tmpDir = makeTmpDir();
  const zipPath = path.join(tmpDir, fileName);
  try {
    await httpsDownloadToFile(info.downloadUrl, zipPath, (r, t) => emitProgress({ modId, kind: 'serverpack', phase: 'downloading', received: r, total: t }));
  } catch (e) {
    rmDirSafe(tmpDir);
    return { ok: false, error: 'Échec du téléchargement : ' + e.message, destDir };
  }

  if (fileName.toLowerCase().endsWith('.zip')) {
    emitProgress({ modId, kind: 'serverpack', phase: 'extracting', received: 0, total: 0 });
    try {
      await extractZip(zipPath, destDir);
      // Si l'archive s'est extraite dans un unique sous-dossier, on l'aplati.
      flattenSingleWrapper(destDir);
    } catch (e) {
      rmDirSafe(tmpDir);
      return { ok: false, error: "Téléchargé mais extraction échouée : " + e.message, destDir };
    }
  } else {
    // Fichier non-zip : on le dépose tel quel dans le dossier de destination.
    try {
      fs.copyFileSync(zipPath, path.join(destDir, fileName));
    } catch (e) {
      /* best-effort */
    }
  }

  // Marqueur : permet ensuite d'interdire le re-téléchargement de ce serverpack.
  minecraftManager.writeServerpackMarker(destDir, {
    modId,
    serverPackFileId,
    name: name || null,
    installedAt: new Date().toISOString(),
  });

  rmDirSafe(tmpDir);
  emitProgress({ modId, kind: 'serverpack', phase: 'done', received: 0, total: 0 });
  return { ok: true, destDir };
}

// ---- Installation d'un modpack comme profil du launcher officiel ----

/**
 * Télécharge le modpack client (fichier `fileId`), résout le loader et sa
 * version depuis le manifest, télécharge tous les mods, copie les overrides,
 * installe le loader (Fabric/Forge/NeoForge), crée un profil dans le launcher
 * Minecraft officiel avec l'icône du modpack.
 */
async function installModpackProfile(opts) {
  const { modId, fileId, name, thumbnailUrl } = opts;
  if (!fileId) return { ok: false, error: 'Aucune version sélectionnée.' };

  if (!fs.existsSync(launcher.getMinecraftDir())) {
    return { ok: false, error: 'Dossier .minecraft introuvable (' + launcher.getMinecraftDir() + '). Le launcher Minecraft officiel est-il installé et lancé au moins une fois ?' };
  }

  const tmpDir = makeTmpDir();
  const prog = (phase, extra) => emitProgress({ modId, kind: 'install', phase, received: 0, total: 0, ...(extra || {}) });

  try {
    // 1) Résolution + téléchargement du zip client
    prog('resolving');
    const info = await resolveDownloadInfo(modId, fileId);
    if (!info.downloadUrl) {
      return { ok: false, error: "Téléchargement de cette version désactivé par l'auteur sur CurseForge. Installation impossible automatiquement." };
    }
    const zipPath = path.join(tmpDir, info.fileName || 'modpack.zip');
    await httpsDownloadToFile(info.downloadUrl, zipPath, (r, t) => emitProgress({ modId, kind: 'install', phase: 'downloading', received: r, total: t }));

    // 2) Extraction + lecture du manifest
    prog('extracting');
    const extractDir = path.join(tmpDir, 'extract');
    fs.mkdirSync(extractDir, { recursive: true });
    await extractZip(zipPath, extractDir);

    const manifestPath = path.join(extractDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      return { ok: false, error: "Ce fichier ne contient pas de manifest.json (ce n'est peut-être pas un modpack client CurseForge classique)." };
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const mcVersion = manifest.minecraft && manifest.minecraft.version;
    const loaders = (manifest.minecraft && manifest.minecraft.modLoaders) || [];
    const primaryLoader = loaders.find((l) => l.primary) || loaders[0];
    if (!mcVersion || !primaryLoader || !primaryLoader.id) {
      return { ok: false, error: 'Manifest incomplet (version Minecraft ou loader manquant).' };
    }
    const files = Array.isArray(manifest.files) ? manifest.files : [];

    // 3) Dossier d'instance dédié
    const slug = launcher.slugify(name || manifest.name || 'modpack');
    const instanceDir = path.join(launcher.getInstancesDir(), slug);

    // Déjà installé pour ce fileId ? (marqueur)
    const existingMarker = launcher.readInstanceMarker(instanceDir);
    if (existingMarker && existingMarker.fileId === fileId) {
      return { ok: false, alreadyInstalled: true, error: 'Cette version est déjà installée (' + instanceDir + ').' };
    }

    fs.mkdirSync(instanceDir, { recursive: true });
    const modsDir = path.join(instanceDir, 'mods');
    fs.mkdirSync(modsDir, { recursive: true });

    // 4) Copie des overrides (configs, resourcepacks, parfois des mods)
    const overridesName = manifest.overrides || 'overrides';
    const overridesDir = path.join(extractDir, overridesName);
    if (fs.existsSync(overridesDir)) {
      prog('overrides');
      for (const entry of fs.readdirSync(overridesDir)) {
        copyRecursive(path.join(overridesDir, entry), path.join(instanceDir, entry));
      }
    }

    // 5) Téléchargement de tous les mods listés dans le manifest
    const failedMods = [];
    let done = 0;
    for (const f of files) {
      done++;
      emitProgress({ modId, kind: 'install', phase: 'mods', received: done, total: files.length });
      try {
        const modInfo = await resolveDownloadInfo(f.projectID, f.fileID);
        if (!modInfo.downloadUrl) {
          failedMods.push({ projectID: f.projectID, fileID: f.fileID, reason: 'distribution désactivée' });
          continue;
        }
        const modFileName = modInfo.fileName || f.fileID + '.jar';
        await launcher.downloadToFile(modInfo.downloadUrl, path.join(modsDir, modFileName), { 'x-api-key': API_KEY });
      } catch (e) {
        failedMods.push({ projectID: f.projectID, fileID: f.fileID, reason: e.message });
      }
    }

    // 6) Installation du loader
    prog('loader', { loader: primaryLoader.id });
    const loaderRes = await launcher.installLoader(primaryLoader.id, mcVersion, tmpDir);
    if (!loaderRes.ok) {
      return {
        ok: false,
        step: 'loader',
        needsJava: !!loaderRes.needsJava,
        error: loaderRes.error,
        instanceDir,
        failedMods,
      };
    }

    // 7) Icône du profil
    prog('icon');
    const iconDataUri = await buildIconDataUri(thumbnailUrl, tmpDir);

    // 8) Création du profil dans le launcher officiel
    prog('profile');
    const upsert = launcher.upsertProfile({
      name: name || manifest.name || slug,
      versionId: loaderRes.versionId,
      gameDir: instanceDir,
      iconDataUri,
    });
    if (!upsert.ok) {
      return { ok: false, step: 'profile', error: upsert.error, instanceDir, failedMods };
    }

    // 9) Marqueur d'instance (pour lister/griser ensuite)
    launcher.writeInstanceMarker(instanceDir, {
      modId,
      fileId,
      name: name || manifest.name || slug,
      mcVersion,
      loader: primaryLoader.id.split('-')[0],
      loaderVersion: primaryLoader.id.slice(primaryLoader.id.indexOf('-') + 1),
      versionId: loaderRes.versionId,
      installedAt: new Date().toISOString(),
      failedModsCount: failedMods.length,
    });

    prog('done');
    return {
      ok: true,
      instanceDir,
      versionId: loaderRes.versionId,
      mcVersion,
      loader: primaryLoader.id,
      totalMods: files.length,
      failedMods,
    };
  } catch (e) {
    return { ok: false, error: 'Erreur pendant l\'installation : ' + e.message };
  } finally {
    rmDirSafe(tmpDir);
  }
}

module.exports = {
  getApiKey,
  setProgressBroadcaster,
  searchModpacks,
  getModpackFiles,
  getCategories,
  downloadServerPack,
  installModpackProfile,
  PAGE_SIZE,
};
