'use strict';

const { app, BrowserWindow, ipcMain, Tray, Menu, shell, dialog, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { execFile } = require('child_process');

const { scanAllGames } = require('./scanners/scanAll');
const manualGames = require('./scanners/manualGames');
const { loadCache, saveCache } = require('./scanners/gameCache');
const minecraftManager = require('./servers/minecraftManager');
const arkManager = require('./servers/arkManager');
const steamcmdManager = require('./servers/steamcmdManager');
const curseforgeManager = require('./servers/curseforgeManager');
const minecraftLauncher = require('./services/minecraftLauncher');
const systemMonitor = require('./services/systemMonitor');
const folderStats = require('./services/folderStats');
const appSettings = require('./services/appSettings');
const processManager = require('./servers/processManager');

const SYNC_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // resynchronisation par défaut : 1 semaine

let mainWindow = null;
let tray = null;
let isQuitting = false;

const startMinimized = process.argv.includes('--minimized');

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: !startMinimized,
    backgroundColor: '#0B0C10',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'renderer', 'assets', 'app-icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Fenêtrée par défaut (barre de titre normale, redimensionnable), mais
  // ouverte maximisée pour profiter du plein espace sans passer en mode
  // plein écran exclusif (qui masquerait les contrôles de fenêtre).
  if (!startMinimized) mainWindow.maximize();

  processManager.setBroadcaster((channel, payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
  });

  // Progression des téléchargements CurseForge (modpack / serverpack).
  curseforgeManager.setProgressBroadcaster((payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('cf-download-progress', payload);
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // On intercepte la réduction et la fermeture pour toujours passer par la
  // zone de notification plutôt que de fermer réellement l'appli.
  mainWindow.on('minimize', (e) => {
    e.preventDefault();
    minimizeToTray();
  });

  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      minimizeToTray();
    }
  });

  if (startMinimized) {
    minimizeToTray();
  }
}

function minimizeToTray() {
  if (!mainWindow) return;
  mainWindow.hide();
  ensureTray();
}

function ensureTray() {
  if (tray) return;

  const icon = nativeImage.createFromPath(path.join(__dirname, 'renderer', 'assets', 'tray-icon.png'));
  tray = new Tray(icon);
  tray.setToolTip('G-GameManager');

  const menu = Menu.buildFromTemplate([
    { label: 'Ouvrir', click: showWindow },
    { label: 'Quitter', click: () => { isQuitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
  tray.on('double-click', showWindow);
}

function showWindow() {
  if (!mainWindow) return;
  mainWindow.show();
  mainWindow.focus();
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  // On garde l'appli active dans la zone de notification tant que l'utilisateur
  // n'a pas explicitement choisi "Quitter".
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
  else showWindow();
});

// ---- IPC ----

ipcMain.handle('scan-games', async (_evt, forceRescan) => {
  const cache = loadCache();
  const isFresh = !!cache && Date.now() - cache.lastSync < SYNC_INTERVAL_MS;

  if (!forceRescan && isFresh) {
    return { games: cache.games, lastSync: cache.lastSync, fromCache: true };
  }

  const rawGames = await scanAllGames();
  const games = rawGames.map((g) => ({
    ...g,
    iconUrl: g.iconPath ? pathToFileURL(g.iconPath).href : null,
  }));

  const saved = saveCache(games);
  return { games: saved.games, lastSync: saved.lastSync, fromCache: false };
});

ipcMain.handle('launch-game', (_evt, game) => {
  try {
    if (game.launchMode === 'uri') {
      shell.openExternal(game.launchTarget);
    } else {
      const child = execFile(game.launchTarget, game.launchArgs || [], {
        cwd: game.workingDirectory || undefined,
      });
      child.unref();
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('get-manual-games', () => manualGames.loadEntries());

ipcMain.handle('add-manual-game', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choisir un exécutable ou un raccourci',
    properties: ['openFile'],
    filters: [
      { name: 'Exécutables et raccourcis', extensions: ['exe', 'lnk'] },
      { name: 'Tous les fichiers', extensions: ['*'] },
    ],
  });

  if (result.canceled || result.filePaths.length === 0) return null;

  let selectedPath = result.filePaths[0];

  if (selectedPath.toLowerCase().endsWith('.lnk')) {
    const resolved = await manualGames.resolveShortcut(selectedPath);
    if (!resolved) return { error: 'shortcut' };
    selectedPath = resolved;
  }

  const defaultName = path.basename(selectedPath, path.extname(selectedPath));
  return { exePath: selectedPath, defaultName };
});

ipcMain.handle('confirm-manual-game', (_evt, { name, exePath }) => {
  manualGames.addEntry(name, exePath);
  return true;
});

ipcMain.handle('remove-manual-game', (_evt, exePath) => {
  manualGames.removeEntry(exePath);
  return true;
});

ipcMain.handle('get-startup-enabled', () => app.getLoginItemSettings().openAtLogin);

ipcMain.handle('set-startup-enabled', (_evt, enabled) => {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    args: enabled ? ['--minimized'] : [],
  });
  return true;
});

ipcMain.handle('minimize-to-tray', () => minimizeToTray());

ipcMain.handle('quit-app', () => {
  isQuitting = true;
  app.quit();
});

// ---- Serveurs Minecraft ----

ipcMain.handle('mc-get-root-folder', () => minecraftManager.getRootFolder());

ipcMain.handle('mc-choose-root-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choisir le dossier contenant vos serveurs Minecraft',
    properties: ['openDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;

  minecraftManager.setRootFolder(result.filePaths[0]);
  return result.filePaths[0];
});

ipcMain.handle('mc-list-servers', () => {
  const root = minecraftManager.getRootFolder();
  return { rootFolder: root, servers: minecraftManager.listServers(root) };
});

ipcMain.handle('mc-read-properties', (_evt, serverPath) => minecraftManager.readServerProperties(serverPath));

ipcMain.handle('mc-write-properties', (_evt, serverPath, updates) =>
  minecraftManager.writeServerProperties(serverPath, updates)
);

ipcMain.handle('mc-read-launch-args', (_evt, serverPath) => minecraftManager.readLaunchArgs(serverPath));

ipcMain.handle('mc-write-launch-args', (_evt, serverPath, argsText) =>
  minecraftManager.writeLaunchArgs(serverPath, argsText)
);

function mcServerId(serverPath) {
  return `mc:${serverPath}`;
}

ipcMain.handle('mc-launch-server', (_evt, serverPath, launchScript, launchScriptType) => {
  if (!launchScript) return { ok: false, error: 'Aucun script de lancement détecté pour ce serveur.' };

  const scriptPath = path.join(serverPath, launchScript);
  const command = launchScriptType === 'ps1' ? 'powershell.exe' : 'cmd.exe';
  const args =
    launchScriptType === 'ps1'
      ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath]
      : ['/c', scriptPath];

  return processManager.startProcess(mcServerId(serverPath), command, args, { cwd: serverPath });
});

ipcMain.handle('mc-stop-server', (_evt, serverPath) =>
  processManager.stopProcess(mcServerId(serverPath), { graceful: true })
);

ipcMain.handle('mc-force-stop-server', (_evt, serverPath) => processManager.forceStop(mcServerId(serverPath)));

ipcMain.handle('mc-get-server-status', (_evt, serverPath) => processManager.getState(mcServerId(serverPath)));

ipcMain.handle('mc-send-command', (_evt, serverPath, command) =>
  processManager.sendCommand(mcServerId(serverPath), command)
);

// ---- CurseForge (modpacks) ----

ipcMain.handle('cf-search-modpacks', (_evt, opts) => curseforgeManager.searchModpacks(opts || {}));

ipcMain.handle('cf-get-categories', () => curseforgeManager.getCategories());

ipcMain.handle('cf-get-modpack-files', (_evt, modId) => curseforgeManager.getModpackFiles(modId));

ipcMain.handle('cf-install-profile', (_evt, opts) => curseforgeManager.installModpackProfile(opts || {}));

ipcMain.handle('cf-download-serverpack', (_evt, opts) => curseforgeManager.downloadServerPack(opts || {}));

ipcMain.handle('cf-get-installed-serverpacks', () => minecraftManager.getInstalledServerpacks());

// ---- Profils Minecraft (launcher officiel) ----

ipcMain.handle('mcp-list-profiles', () => minecraftLauncher.listProfiles());

ipcMain.handle('mcp-get-installed-modpacks', () => minecraftLauncher.listInstalledModpacks());

ipcMain.handle('mcp-open-path', (_evt, targetPath) => {
  if (targetPath) shell.openPath(targetPath);
  return { ok: true };
});

ipcMain.handle('mcp-play-profile', (_evt, profileKey) => minecraftLauncher.playProfile(profileKey));

ipcMain.handle('mcp-uninstall-profile', (_evt, profileKey) => minecraftLauncher.uninstallProfile(profileKey));

// ---- Serveur Ark ----

ipcMain.handle('ark-get-root-folder', async () => (await arkManager.getOrAutoDetectRootFolder()).rootFolder);

ipcMain.handle('ark-choose-root-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choisir le dossier contenant vos serveurs Ark',
    properties: ['openDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;

  arkManager.setRootFolder(result.filePaths[0]);
  return result.filePaths[0];
});

ipcMain.handle('ark-list-servers', async () => {
  const { rootFolder, autoDetected } = await arkManager.getOrAutoDetectRootFolder();
  return { rootFolder, autoDetected, servers: arkManager.listServers(rootFolder) };
});

ipcMain.handle('ark-get-known-maps', () => arkManager.KNOWN_MAPS);

ipcMain.handle('ark-read-settings', (_evt, serverPath) => arkManager.readSettings(serverPath));

ipcMain.handle('ark-write-settings', (_evt, serverPath, updates) => arkManager.writeSettings(serverPath, updates));

ipcMain.handle('ark-read-launch-config', (_evt, serverPath) => arkManager.readLaunchConfig(serverPath));

ipcMain.handle('ark-write-launch-config', (_evt, serverPath, config) =>
  arkManager.writeLaunchConfig(serverPath, config)
);

function arkServerId(serverPath) {
  return `ark:${serverPath}`;
}

function launchArkServerProcess(serverPath, config) {
  let exePath;
  let args;
  try {
    exePath = arkManager.findServerExecutable(serverPath);
    if (!exePath) throw new Error("Exécutable du serveur Ark introuvable dans ShooterGame\\Binaries\\Win64.");
    args = arkManager.buildLaunchArgs(config);
  } catch (e) {
    return { ok: false, error: e.message };
  }

  return processManager.startProcess(arkServerId(serverPath), exePath, args, { cwd: path.dirname(exePath) });
}

ipcMain.handle('ark-launch-server', (_evt, serverPath, config) => launchArkServerProcess(serverPath, config));

ipcMain.handle('ark-stop-server', (_evt, serverPath) =>
  processManager.stopProcess(arkServerId(serverPath), { graceful: false })
);

ipcMain.handle('ark-force-stop-server', (_evt, serverPath) => processManager.forceStop(arkServerId(serverPath)));

ipcMain.handle('ark-get-server-status', (_evt, serverPath) => processManager.getState(arkServerId(serverPath)));

ipcMain.handle('ark-send-command', (_evt, serverPath, command) =>
  processManager.sendCommand(arkServerId(serverPath), command)
);

ipcMain.handle('ark-generate-script', (_evt, serverPath, config) => {
  try {
    const scriptPath = arkManager.generateLaunchScript(serverPath, config);
    return { ok: true, scriptPath };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

/**
 * Donne une preuve de progression indépendante de la console pendant une
 * installation SteamCMD : SteamCMD bufferise souvent entièrement sa sortie
 * standard quand elle est redirigée (pas un vrai terminal) et peut rester
 * silencieux plusieurs minutes même quand le téléchargement avance
 * normalement. On mesure donc directement la taille du dossier en cours de
 * création, qui grossit réellement au fur et à mesure du téléchargement.
 */
ipcMain.handle('ark-get-install-progress', (_evt, parentFolder, folderName, edition) => {
  const serverPath = arkServerPath(parentFolder, edition, folderName);
  return folderStats.getFolderStats(serverPath);
});

function arkInstallId(serverPath) {
  return `ark-install:${serverPath}`;
}

/** Attend qu'un processus suivi par processManager se termine (poll simple, pas d'API d'évènement exposée). */
function waitForProcessToFinish(id, pollMs = 1500) {
  return new Promise((resolve) => {
    const check = () => {
      const state = processManager.getState(id);
      if (state.status === 'running' || state.status === 'starting') {
        setTimeout(check, pollMs);
      } else {
        resolve(state);
      }
    };
    check();
  });
}

const ARK_APP_IDS = {
  ascended: '2430930',
  evolved: '376030',
};

// Sous-dossier dans lequel chaque serveur est automatiquement rangé selon son
// édition, pour garder une arborescence propre quand on gère plusieurs
// serveurs Evolved et Ascended dans le même dossier racine.
const ARK_EDITION_FOLDER_NAMES = {
  ascended: 'ARK Survival Ascended',
  evolved: 'ARK Survival Evolved',
};

function arkServerPath(parentFolder, edition, folderName) {
  const editionFolder = ARK_EDITION_FOLDER_NAMES[edition] || 'Autre';
  return path.join(parentFolder, editionFolder, folderName);
}

/**
 * Assistant de création : installe un nouveau serveur Ark via SteamCMD dans un
 * dossier dédié, applique les paramètres choisis (carte, difficulté,
 * multiplicateurs...), puis le lance automatiquement. Chaque étape peut
 * échouer indépendamment ; le renderer suit la progression en temps réel via
 * les évènements de console habituels (id `ark-install:<chemin>`).
 */
ipcMain.handle('ark-create-and-launch-server', async (_evt, options) => {
  const {
    parentFolder, folderName, edition, map, sessionName, serverPassword,
    adminPassword, maxPlayers, port, queryPort, extraSessionParams, extraFlags,
    pve, difficulty, overrideOfficialDifficulty, xpMultiplier, tamingMultiplier, harvestMultiplier,
  } = options;

  if (!steamcmdManager.isInstalled()) {
    return { ok: false, step: 'steamcmd', error: "SteamCMD n'est pas installé. Utilise le bouton de téléchargement du panneau SteamCMD d'abord." };
  }

  // SteamCMD ne peut pas tourner deux fois simultanément depuis le même dossier
  // (verrou interne) : si la session interactive du panneau du haut est déjà
  // lancée, une seconde instance pour l'installation resterait bloquée sans
  // jamais produire la moindre sortie, ce qui donnerait l'impression que
  // l'assistant "ne fait rien". On le détecte donc en amont plutôt que de
  // laisser l'utilisateur face à un blocage silencieux.
  if (processManager.isRunning(steamcmdManager.PROCESS_ID)) {
    return {
      ok: false,
      step: 'steamcmd',
      error: "SteamCMD est déjà lancé (panneau ci-dessus). Ferme cette session (bouton « Arrêter ») avant de créer un nouveau serveur : SteamCMD ne peut pas être utilisé deux fois en même temps.",
    };
  }

  const appId = ARK_APP_IDS[edition];
  if (!appId) {
    return { ok: false, step: 'validation', error: 'Édition Ark inconnue (Ascended/Evolved).' };
  }
  if (!parentFolder || !folderName || !folderName.trim()) {
    return { ok: false, step: 'validation', error: 'Dossier parent ou nom de serveur manquant.' };
  }

  // Rangé automatiquement dans un sous-dossier "ARK Survival Ascended" ou
  // "ARK Survival Evolved" selon l'édition choisie ; créé s'il n'existe pas
  // déjà (fs.mkdirSync récursif un peu plus bas s'en charge).
  const serverPath = arkServerPath(parentFolder, edition, folderName.trim());

  if (fs.existsSync(serverPath) && fs.readdirSync(serverPath).length > 0) {
    return { ok: false, step: 'validation', error: `Le dossier "${folderName.trim()}" existe déjà et n'est pas vide.` };
  }

  try {
    fs.mkdirSync(serverPath, { recursive: true });
  } catch (e) {
    return { ok: false, step: 'folder', error: `Impossible de créer le dossier : ${e.message}` };
  }

  // Étape 1 : installation via SteamCMD, en mode non interactif (une seule
  // commande qui télécharge puis quitte toute seule), suivie en direct dans
  // la console de l'assistant côté renderer.
  const installId = arkInstallId(serverPath);
  const installArgs = [
    '+force_install_dir', serverPath,
    '+login', 'anonymous',
    '+app_update', appId, 'validate',
    '+quit',
  ];

  const startResult = processManager.startProcess(installId, steamcmdManager.getSteamCmdExePath(), installArgs, {
    cwd: steamcmdManager.getSteamCmdDir(),
  });
  if (!startResult.ok) {
    return { ok: false, step: 'install', error: startResult.error };
  }

  const finalInstallState = await waitForProcessToFinish(installId);
  if (finalInstallState.status !== 'stopped') {
    return {
      ok: false,
      step: 'install',
      error: finalInstallState.errorMessage || "L'installation via SteamCMD a échoué ou a été interrompue.",
    };
  }

  const installedExe = arkManager.findServerExecutable(serverPath);
  if (!installedExe) {
    return {
      ok: false,
      step: 'install',
      error: "L'installation semble incomplète : aucun exécutable serveur trouvé une fois SteamCMD terminé.",
    };
  }

  // Vérification de cohérence : l'exécutable réellement présent doit correspondre
  // à l'édition demandée. Sans ce contrôle, un cache SteamCMD corrompu (voir le
  // bouton "Réinitialiser SteamCMD") pourrait installer silencieusement les
  // mauvais fichiers tout en semblant avoir réussi — on préfère échouer bruyamment
  // ici plutôt que de lancer un serveur différent de celui demandé.
  const installedExeName = path.basename(installedExe).toLowerCase();
  const installedEdition = installedExeName.includes('ascended')
    ? 'ascended'
    : installedExeName.includes('shootergameserver')
      ? 'evolved'
      : null;

  if (installedEdition && installedEdition !== edition) {
    return {
      ok: false,
      step: 'install',
      error:
        `Incohérence détectée : tu as demandé l'édition "${edition}" mais l'exécutable installé ` +
        `("${path.basename(installedExe)}") correspond à "${installedEdition}". SteamCMD a probablement ` +
        `installé les mauvais fichiers à cause d'un cache corrompu — utilise le bouton ` +
        `"🔄 Réinitialiser SteamCMD" dans le panneau ci-dessus, puis retélécharge SteamCMD et réessaie. ` +
        `Le dossier "${folderName.trim()}" a été créé mais n'a volontairement pas été lancé.`,
    };
  }

  // Étape 2 : paramètres serveur initiaux (GameUserSettings.ini)
  try {
    arkManager.writeSettings(serverPath, [
      { file: 'gameUserSettings', section: 'ServerSettings', key: 'ServerPVE', value: pve ? 'True' : 'False' },
      { file: 'gameUserSettings', section: 'ServerSettings', key: 'DifficultyOffset', value: String(difficulty) },
      // Contrôle le niveau maximum des dinosaures sauvages : niveau max ≈ 30 × cette valeur
      // (5.0 = niveau 150, le standard le plus courant sur les serveurs communautaires,
      // contre 30 par défaut sur un serveur officiel avec la valeur 1.0).
      { file: 'gameUserSettings', section: 'ServerSettings', key: 'OverrideOfficialDifficulty', value: String(overrideOfficialDifficulty || 5) },
      { file: 'gameUserSettings', section: 'ServerSettings', key: 'XPMultiplier', value: String(xpMultiplier) },
      { file: 'gameUserSettings', section: 'ServerSettings', key: 'TamingSpeedMultiplier', value: String(tamingMultiplier) },
      { file: 'gameUserSettings', section: 'ServerSettings', key: 'HarvestAmountMultiplier', value: String(harvestMultiplier) },
    ]);
  } catch (e) {
    return { ok: false, step: 'settings', error: e.message };
  }

  // Étape 3 : configuration de lancement (carte, session, ports...)
  let launchConfig;
  try {
    launchConfig = arkManager.writeLaunchConfig(serverPath, {
      map, sessionName, serverPassword, adminPassword, maxPlayers, port, queryPort,
      extraSessionParams: extraSessionParams || '',
      extraFlags: extraFlags || '-server -log',
    });
  } catch (e) {
    return { ok: false, step: 'launch-config', error: e.message };
  }

  // Étape 4 : lancement effectif
  const launchResult = launchArkServerProcess(serverPath, launchConfig);
  if (!launchResult.ok) {
    return { ok: false, step: 'launch', error: launchResult.error, serverPath };
  }

  return { ok: true, serverPath };
});

// ---- SteamCMD ----

ipcMain.handle('steamcmd-is-installed', () => steamcmdManager.isInstalled());

ipcMain.handle('steamcmd-download', () => steamcmdManager.download());

ipcMain.handle('steamcmd-reset', () => steamcmdManager.reset());

ipcMain.handle('steamcmd-launch', () => {
  if (processManager.isAnyRunningWithPrefix('ark-install:')) {
    return {
      ok: false,
      error: "Une installation automatique via l'assistant « Créer un serveur » est déjà en cours en arrière-plan. SteamCMD ne peut pas être lancé deux fois en même temps : attends la fin de l'installation avant de démarrer une session manuelle.",
    };
  }
  return steamcmdManager.launch();
});

ipcMain.handle('steamcmd-stop', () => steamcmdManager.stop());

ipcMain.handle('steamcmd-force-stop', () => steamcmdManager.forceStop());

ipcMain.handle('steamcmd-send-command', (_evt, command) => steamcmdManager.sendCommand(command));

ipcMain.handle('steamcmd-get-status', () => steamcmdManager.getStatus());

// ---- Performance ----

ipcMain.handle('perf-get-snapshot', () => systemMonitor.getSnapshot());

// ---- Réglages ----

ipcMain.handle('settings-get', () => appSettings.getSettings());

ipcMain.handle('settings-set', (_evt, key, value) => appSettings.setSetting(key, value));
