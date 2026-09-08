'use strict';

// -----------------------------------------------------------------------------
// Mise à jour automatique de l'application (Phase E).
//
// Ce module encapsule `electron-updater`. Le CODE est prêt ; l'HÉBERGEMENT du
// flux de mises à jour (GitHub Releases, serveur générique, S3...) sera branché
// plus tard en renseignant la section `build.publish` du package.json et en
// publiant les artefacts via `electron-builder`.
//
// Tant que l'hébergement n'est pas configuré (ou que l'appli tourne en mode
// développement, ou que le paquet `electron-updater` n'est pas encore installé),
// ce module reste inerte : il ne plante jamais l'application et se contente de
// signaler un état « désactivé » à l'interface.
// -----------------------------------------------------------------------------

const { app } = require('electron');

let autoUpdater = null;
let moduleError = null;

// `electron-updater` peut ne pas être encore installé (npm install à faire).
// On le charge de façon défensive pour ne jamais bloquer le démarrage.
try {
  autoUpdater = require('electron-updater').autoUpdater;
} catch (err) {
  moduleError = err && err.message ? err.message : String(err);
  autoUpdater = null;
}

let broadcaster = null;
let initialized = false;
let lastState = { state: 'idle' };

function emit(payload) {
  lastState = payload;
  if (typeof broadcaster === 'function') {
    try { broadcaster('update-status', payload); } catch (_) { /* renderer absent */ }
  }
}

// L'auto-updater n'est réellement opérationnel que sur une appli empaquetée
// (installée). En développement, `electron-updater` cherche un fichier
// `dev-app-update.yml` et lève une erreur : on l'évite proprement.
function isOperational() {
  return !!autoUpdater && app.isPackaged;
}

function init(broadcastFn) {
  broadcaster = broadcastFn || null;
  if (initialized) return;
  initialized = true;

  if (!autoUpdater) {
    emit({ state: 'disabled', reason: 'module', detail: moduleError });
    return;
  }

  // On garde la main sur le téléchargement et l'installation : rien ne se fait
  // dans le dos de l'utilisateur.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on('checking-for-update', () => emit({ state: 'checking' }));
  autoUpdater.on('update-available', (info) => emit({
    state: 'available',
    version: info && info.version,
    releaseNotes: info && info.releaseNotes,
    releaseDate: info && info.releaseDate,
  }));
  autoUpdater.on('update-not-available', (info) => emit({
    state: 'not-available',
    version: (info && info.version) || app.getVersion(),
  }));
  autoUpdater.on('download-progress', (p) => emit({
    state: 'downloading',
    percent: p ? Math.round(p.percent) : 0,
    transferred: p && p.transferred,
    total: p && p.total,
    bytesPerSecond: p && p.bytesPerSecond,
  }));
  autoUpdater.on('update-downloaded', (info) => emit({
    state: 'downloaded',
    version: info && info.version,
  }));
  autoUpdater.on('error', (err) => emit({
    state: 'error',
    detail: err && err.message ? err.message : String(err),
  }));
}

// Vérifie la présence d'une mise à jour. Ne télécharge pas automatiquement.
async function checkForUpdates() {
  if (!autoUpdater) {
    const payload = { state: 'disabled', reason: 'module', detail: moduleError };
    emit(payload);
    return payload;
  }
  if (!app.isPackaged) {
    const payload = { state: 'disabled', reason: 'dev' };
    emit(payload);
    return payload;
  }
  try {
    await autoUpdater.checkForUpdates();
    return lastState;
  } catch (err) {
    const payload = { state: 'error', detail: err && err.message ? err.message : String(err) };
    emit(payload);
    return payload;
  }
}

// Télécharge la mise à jour détectée.
async function downloadUpdate() {
  if (!isOperational()) {
    return { state: 'disabled' };
  }
  try {
    await autoUpdater.downloadUpdate();
    return lastState;
  } catch (err) {
    const payload = { state: 'error', detail: err && err.message ? err.message : String(err) };
    emit(payload);
    return payload;
  }
}

// Quitte et installe la mise à jour téléchargée (redémarre l'appli).
function quitAndInstall() {
  if (!isOperational()) return { ok: false, state: 'disabled' };
  // isSilent = false, isForceRunAfter = true : on relance l'appli après l'install.
  setImmediate(() => autoUpdater.quitAndInstall(false, true));
  return { ok: true };
}

// Vérification silencieuse au démarrage : ne fait rien si l'updater n'est pas
// opérationnel, et n'affiche jamais d'erreur bloquante à l'utilisateur.
async function checkOnStartup() {
  if (!isOperational()) return;
  try {
    await autoUpdater.checkForUpdates();
  } catch (_) {
    // Flux non configuré / réseau indisponible : on reste silencieux au démarrage.
  }
}

function getStatus() {
  return {
    moduleAvailable: !!autoUpdater,
    packaged: app.isPackaged,
    operational: isOperational(),
    currentVersion: app.getVersion(),
    lastState,
  };
}

module.exports = {
  init,
  checkForUpdates,
  downloadUpdate,
  quitAndInstall,
  checkOnStartup,
  getStatus,
};
