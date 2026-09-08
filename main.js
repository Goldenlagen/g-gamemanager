'use strict';

const { app, BrowserWindow, ipcMain, Tray, Menu, shell, dialog, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { execFile } = require('child_process');
const https = require('https');
const os = require('os');

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
const rconClient = require('./servers/rconClient');
const serverStats = require('./services/serverStats');
const steamgriddb = require('./services/steamgriddb');
const backups = require('./services/backups');
const autoUpdater = require('./services/autoUpdater');
const i18n = require('./services/i18n');

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

  buildTrayMenu();
  tray.on('double-click', showWindow);
}

// Menu de la zone de notification, reconstruit à chaque changement de langue.
function buildTrayMenu() {
  if (!tray) return;
  const menu = Menu.buildFromTemplate([
    { label: i18n.t('tray.open'), click: showWindow },
    { label: i18n.t('tray.quit'), click: () => { isQuitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
}

function showWindow() {
  if (!mainWindow) return;
  mainWindow.show();
  mainWindow.focus();
}

app.whenReady().then(() => {
  createWindow();
  rebuildRestartSchedules();

  // Mise à jour automatique (Phase E) : on relaie les événements vers le
  // renderer. Inerte tant que l'hébergement du flux n'est pas branché.
  autoUpdater.init((channel, payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
  });

  // Auto-démarrage des serveurs marqués, une fois l'appli stabilisée.
  setTimeout(() => { autoStartEnabledServers(); }, 4000);

  // Vérification silencieuse des mises à jour, seulement si l'utilisateur ne
  // l'a pas désactivée (et si le flux est configuré côté build).
  setTimeout(() => {
    const settings = appSettings.getSettings();
    if (settings.autoUpdateCheck !== false) autoUpdater.checkOnStartup();
  }, 8000);
});

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

// Applique les jaquettes personnalisées (SteamGridDB) : la surcharge devient la
// boxArtUrl du jeu, donc la tuile et le panneau l'utilisent automatiquement.
function applyArtworkOverrides(games) {
  const overrides = steamgriddb.getOverrides();
  if (!overrides || Object.keys(overrides).length === 0) return games;
  for (const g of games) {
    const key = g.platform + ':' + g.name;
    if (overrides[key]) g.boxArtUrl = overrides[key];
  }
  return games;
}

ipcMain.handle('scan-games', async (_evt, forceRescan) => {
  const cache = loadCache();
  const isFresh = !!cache && Date.now() - cache.lastSync < SYNC_INTERVAL_MS;

  if (!forceRescan && isFresh) {
    return { games: applyArtworkOverrides(cache.games), lastSync: cache.lastSync, fromCache: true };
  }

  const rawGames = await scanAllGames();
  const games = rawGames.map((g) => ({
    ...g,
    iconUrl: g.iconPath ? pathToFileURL(g.iconPath).href : null,
  }));

  const saved = saveCache(games);
  return { games: applyArtworkOverrides(saved.games), lastSync: saved.lastSync, fromCache: false };
});

// ---- SteamGridDB (jaquettes) ----

ipcMain.handle('sgdb-status', () => ({ hasKey: steamgriddb.hasKey() }));

ipcMain.handle('sgdb-fetch', (_evt, gameKey, gameName) => steamgriddb.fetchAndApply(gameKey, gameName));

ipcMain.handle('sgdb-clear', (_evt, gameKey) => {
  steamgriddb.clearOverride(gameKey);
  return { ok: true };
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
    title: i18n.t('dlg.chooseExe'),
    properties: ['openFile'],
    filters: [
      { name: i18n.t('dlg.filterExe'), extensions: ['exe', 'lnk'] },
      { name: i18n.t('dlg.filterAll'), extensions: ['*'] },
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
    title: i18n.t('dlg.chooseMcFolder'),
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

function launchMinecraftServer(serverPath, launchScript, launchScriptType) {
  if (!launchScript) return { ok: false, error: i18n.t('err.mcNoLaunchScript') };

  const scriptPath = path.join(serverPath, launchScript);
  const command = launchScriptType === 'ps1' ? 'powershell.exe' : 'cmd.exe';
  const args =
    launchScriptType === 'ps1'
      ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath]
      : ['/c', scriptPath];

  return processManager.startProcess(mcServerId(serverPath), command, args, { cwd: serverPath });
}

ipcMain.handle('mc-launch-server', (_evt, serverPath, launchScript, launchScriptType) =>
  launchMinecraftServer(serverPath, launchScript, launchScriptType)
);

ipcMain.handle('mc-stop-server', (_evt, serverPath) =>
  processManager.stopProcess(mcServerId(serverPath), { graceful: true })
);

ipcMain.handle('mc-force-stop-server', (_evt, serverPath) => processManager.forceStop(mcServerId(serverPath)));

ipcMain.handle('mc-get-server-status', (_evt, serverPath) => processManager.getState(mcServerId(serverPath)));

ipcMain.handle('mc-send-command', (_evt, serverPath, command) =>
  processManager.sendCommand(mcServerId(serverPath), command)
);

// Joueurs en ligne : envoie la commande « list » et lit la réponse dans le
// tampon de console pour un décompte fiable (nom + nombre).
ipcMain.handle('mc-list-players', async (_evt, serverPath) => {
  const id = mcServerId(serverPath);
  if (!processManager.isRunning(id)) return { ok: true, running: false, count: 0, players: [] };

  processManager.sendCommand(id, 'list');
  await new Promise((r) => setTimeout(r, 700));

  const lines = processManager.getState(id).logLines || [];
  let count = 0;
  let players = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].match(/There are (\d+)\s*(?:of a max of|\/)\s*\d+\s*players online:?\s*(.*)/i);
    if (m) {
      count = Number(m[1]) || 0;
      const names = (m[2] || '').trim();
      players = names ? names.split(/,\s*/).map((s) => s.trim()).filter(Boolean) : [];
      break;
    }
  }
  return { ok: true, running: true, count, players };
});

// Supprime définitivement un serveur Minecraft (dossier de plus haut niveau sous
// la racine, même si le script est dans un sous-dossier). On arrête d'abord tout
// processus, et on vérifie que la cible est bien à l'intérieur de la racine.
ipcMain.handle('mc-delete-server', (_evt, serverPath) => {
  const root = minecraftManager.getRootFolder();
  if (!root) return { ok: false, error: i18n.t('err.mcRootNotFound') };
  try {
    processManager.forceStop(mcServerId(serverPath));
  } catch (e) {
    /* pas grave si aucun process */
  }
  const resolvedRoot = path.resolve(root);
  const rel = path.relative(resolvedRoot, path.resolve(serverPath));
  if (rel.startsWith('..') || path.isAbsolute(rel) || !rel) {
    return { ok: false, error: i18n.t('err.pathOutsideRoot') };
  }
  const topFolder = path.join(resolvedRoot, rel.split(path.sep)[0]);
  try {
    fs.rmSync(topFolder, { recursive: true, force: true });
    return { ok: true, deleted: topFolder };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ---- Listes d'accès Minecraft : whitelist / ops / bans ----

// Résout le UUID d'un pseudo via l'API publique Mojang (best-effort, hors-ligne).
function mojangUuid(name) {
  return new Promise((resolve) => {
    https
      .get('https://api.mojang.com/users/profiles/minecraft/' + encodeURIComponent(name), (res) => {
        if (res.statusCode !== 200) { res.resume(); return resolve(null); }
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          try {
            const j = JSON.parse(raw);
            if (j && j.id) {
              resolve(j.id.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5'));
            } else resolve(null);
          } catch (e) { resolve(null); }
        });
      })
      .on('error', () => resolve(null));
  });
}

const MC_ACCESS_ADD_CMD = { whitelist: 'whitelist add', ops: 'op', bans: 'ban' };
const MC_ACCESS_REMOVE_CMD = { whitelist: 'whitelist remove', ops: 'deop', bans: 'pardon' };

// Adresse Hamachi locale (pour partager un serveur sans configuration réseau).
function getHamachiIp() {
  const ifaces = os.networkInterfaces();
  const isV4 = (a) => a && (a.family === 'IPv4' || a.family === 4) && !a.internal;
  // 1) adaptateur nommé « Hamachi »
  for (const [name, addrs] of Object.entries(ifaces)) {
    if (/hamachi/i.test(name)) {
      const v4 = (addrs || []).find(isV4);
      if (v4) return v4.address;
    }
  }
  // 2) repli : toute adresse dans la plage Hamachi 25.x.x.x
  for (const addrs of Object.values(ifaces)) {
    const v4 = (addrs || []).find((a) => isV4(a) && /^25\./.test(a.address));
    if (v4) return v4.address;
  }
  return null;
}

ipcMain.handle('mc-share-info', (_evt, serverPath) => {
  let port = '25565';
  try {
    const props = minecraftManager.readServerProperties(serverPath);
    if (props.values && props.values['server-port']) port = String(props.values['server-port']);
  } catch (e) { /* défaut 25565 */ }
  return { hamachiIp: getHamachiIp(), port };
});

// ---- Sauvegardes de mondes Minecraft ----

function mcWorldFolders(serverPath) {
  let level = 'world';
  try {
    const props = minecraftManager.readServerProperties(serverPath);
    if (props.values && props.values['level-name']) level = props.values['level-name'];
  } catch (e) { /* défaut "world" */ }
  return [level, level + '_nether', level + '_the_end'];
}

ipcMain.handle('mc-backup-list', (_evt, serverPath) => backups.listBackups(serverPath));

ipcMain.handle('mc-backup-create', async (_evt, serverPath) => {
  const id = mcServerId(serverPath);
  const running = processManager.isRunning(id);
  // Serveur en cours : on fige les sauvegardes du monde le temps du zip.
  if (running) {
    processManager.sendCommand(id, 'save-off');
    processManager.sendCommand(id, 'save-all flush');
    await new Promise((r) => setTimeout(r, 3000));
  }
  const res = await backups.createBackup(serverPath, mcWorldFolders(serverPath));
  if (running) processManager.sendCommand(id, 'save-on');

  if (!res.ok) {
    const msg = res.error === 'noWorld' ? i18n.t('backup.noWorld') : i18n.t('backup.failed', { error: res.error });
    return { ok: false, error: msg, backups: backups.listBackups(serverPath) };
  }
  return { ok: true, name: res.name, backups: backups.listBackups(serverPath) };
});

ipcMain.handle('mc-backup-restore', async (_evt, serverPath, name) => {
  if (processManager.isRunning(mcServerId(serverPath))) {
    return { ok: false, error: i18n.t('backup.restoreRunning'), backups: backups.listBackups(serverPath) };
  }
  const res = await backups.restoreBackup(serverPath, name);
  if (!res.ok) {
    const msg = res.error === 'notFound' ? i18n.t('backup.notFound') : i18n.t('backup.failed', { error: res.error });
    return { ok: false, error: msg, backups: backups.listBackups(serverPath) };
  }
  return { ok: true, backups: backups.listBackups(serverPath) };
});

ipcMain.handle('mc-backup-delete', (_evt, serverPath, name) => {
  backups.deleteBackup(serverPath, name);
  return { ok: true, backups: backups.listBackups(serverPath) };
});

ipcMain.handle('mc-access-list', (_evt, serverPath) => minecraftManager.readAccessLists(serverPath));

ipcMain.handle('mc-access-add', async (_evt, serverPath, list, name) => {
  name = String(name || '').trim();
  if (!name || !MC_ACCESS_ADD_CMD[list]) return { ok: false };

  const id = mcServerId(serverPath);
  if (processManager.isRunning(id)) {
    // Serveur en cours : la console gère la résolution du UUID et met à jour les fichiers.
    processManager.sendCommand(id, `${MC_ACCESS_ADD_CMD[list]} ${name}`);
    await new Promise((r) => setTimeout(r, 700));
  } else {
    // Serveur arrêté : on édite le JSON directement (UUID via Mojang, best-effort).
    const uuid = (await mojangUuid(name)) || '';
    let entry;
    if (list === 'ops') entry = { uuid, name, level: 4, bypassesPlayerLimit: false };
    else if (list === 'bans') {
      entry = { uuid, name, created: new Date().toISOString(), source: 'G-GameManager', expires: 'forever', reason: 'Banned by an operator' };
    } else entry = { uuid, name };
    minecraftManager.addToAccessFile(serverPath, list, entry);
  }
  return { ok: true, lists: minecraftManager.readAccessLists(serverPath) };
});

ipcMain.handle('mc-access-remove', async (_evt, serverPath, list, name) => {
  name = String(name || '').trim();
  if (!name || !MC_ACCESS_REMOVE_CMD[list]) return { ok: false };

  const id = mcServerId(serverPath);
  if (processManager.isRunning(id)) {
    processManager.sendCommand(id, `${MC_ACCESS_REMOVE_CMD[list]} ${name}`);
    await new Promise((r) => setTimeout(r, 700));
  } else {
    minecraftManager.removeFromAccessFile(serverPath, list, name);
  }
  return { ok: true, lists: minecraftManager.readAccessLists(serverPath) };
});

// ---- CurseForge (modpacks) ----

ipcMain.handle('cf-search-modpacks', (_evt, opts) => curseforgeManager.searchModpacks(opts || {}));

ipcMain.handle('cf-get-categories', () => curseforgeManager.getCategories());

ipcMain.handle('cf-get-modpack-files', (_evt, modId) => curseforgeManager.getModpackFiles(modId));

ipcMain.handle('cf-install-profile', (_evt, opts) => curseforgeManager.installModpackProfile(opts || {}));

ipcMain.handle('cf-download-serverpack', (_evt, opts) => curseforgeManager.downloadServerPack(opts || {}));

ipcMain.handle('cf-get-installed-serverpacks', () => minecraftManager.getInstalledServerpacks());

ipcMain.handle('cf-get-mod-logo', (_evt, modId) => curseforgeManager.getModLogo(modId));

// ---- Profils Minecraft (launcher officiel) ----

ipcMain.handle('mcp-list-profiles', () => minecraftLauncher.listProfiles());

ipcMain.handle('mcp-get-installed-modpacks', () => minecraftLauncher.listInstalledModpacks());

ipcMain.handle('mcp-open-path', (_evt, targetPath) => {
  if (targetPath) shell.openPath(targetPath);
  return { ok: true };
});

// Récupère l'AppID (AUMID) du launcher Minecraft via Get-StartApps — fonctionne
// aussi bien pour la version Microsoft Store que pour la version classique
// (toutes deux listées dans le dossier Applications de Windows).
function findLauncherAppId() {
  return new Promise((resolve) => {
    const ps = [
      "$a = Get-StartApps | Where-Object { $_.Name -eq 'Minecraft Launcher' };",
      "if (-not $a) { $a = Get-StartApps | Where-Object { $_.Name -match 'Minecraft' -and $_.Name -match 'Launcher' } };",
      "if (-not $a) { $a = Get-StartApps | Where-Object { $_.Name -match 'Minecraft' } };",
      '$a | Select-Object -First 1 -ExpandProperty AppID',
    ].join(' ');
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps],
      { windowsHide: true, timeout: 15000 },
      (err, stdout) => {
        if (err) return resolve(null);
        const appId = String(stdout || '').trim().split(/\r?\n/)[0].trim();
        resolve(appId || null);
      }
    );
  });
}

// Lance une application par son AppID/AUMID via le dossier Applications de Windows.
function launchByAppId(appId) {
  return new Promise((resolve) => {
    // explorer.exe interprète "shell:AppsFolder\<AppID>" comme l'ouverture de l'app.
    // Il renvoie souvent un code non nul même en cas de succès : on ne s'y fie pas.
    execFile('explorer.exe', ['shell:AppsFolder\\' + appId], { windowsHide: true }, () => {});
    setTimeout(resolve, 400);
  });
}

ipcMain.handle('mcp-play-profile', async (_evt, profileKey) => {
  const r = minecraftLauncher.playProfile(profileKey);
  if (!r.ok) return r;

  // 1) Launcher classique (.exe) si on l'a trouvé sur le disque.
  if (r.exe) {
    try {
      const errStr = await shell.openPath(r.exe);
      if (!errStr) return { ok: true, launched: true, method: 'exe' };
    } catch (e) {
      /* on tente les voies suivantes */
    }
  }

  // 2) Via l'AppID (Store OU classique) découvert par Get-StartApps.
  try {
    const appId = await findLauncherAppId();
    if (appId) {
      await launchByAppId(appId);
      return { ok: true, launched: true, method: 'appid', appId };
    }
  } catch (e) {
    /* ignore */
  }

  // 3) Dernier recours : AUMID connu du launcher unifié Microsoft Store.
  try {
    await launchByAppId('Microsoft.4297127D64EC6_8wekyb3d8bbwe!Minecraft');
    return { ok: true, launched: true, method: 'store-fallback' };
  } catch (e) {
    /* ignore */
  }

  return {
    ok: true,
    launched: false,
    message: i18n.t('mcp.launcherNotFound'),
  };
});

ipcMain.handle('mcp-uninstall-profile', (_evt, profileKey) => minecraftLauncher.uninstallProfile(profileKey));

// Lancement rapide (hors-ligne, sans le launcher officiel). Le service renvoie
// un code d'erreur ; on le traduit ici, à la frontière IPC.
ipcMain.handle('mcp-quick-launch-profile', async (_evt, profileKey) => {
  const r = await minecraftLauncher.quickLaunchProfile(profileKey);
  if (r.ok) return r;

  const messages = {
    profileNotFound: i18n.t('mcl.profileNotFound'),
    noVersion: i18n.t('mcl.qlNoVersion'),
    versionJson: i18n.t('mcl.qlVersionJsonFail', { id: r.versionId, error: r.detail }),
    clientJar: i18n.t('mcl.qlClientJarMissing', { path: r.clientJar }),
    noJava: i18n.t('mcl.qlNoJava'),
    natives: i18n.t('mcl.qlNativesFail', { error: r.detail }),
    spawn: i18n.t('mcl.qlSpawnFail', { error: r.detail }),
  };
  return { ok: false, error: messages[r.error] || i18n.t('mcl.qlSpawnFail', { error: r.error }) };
});

// ---- Serveur Ark ----

ipcMain.handle('ark-get-root-folder', async () => (await arkManager.getOrAutoDetectRootFolder()).rootFolder);

ipcMain.handle('ark-choose-root-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: i18n.t('dlg.chooseArkFolder'),
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
    if (!exePath) throw new Error(i18n.t('err.arkExeNotFound'));
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

// Supprime définitivement un serveur Ark (le dossier du serveur lui-même, ex:
// <racine>/ARK Survival Ascended/MonServeur). Arrête d'abord tout processus et
// vérifie que la cible est bien à l'intérieur de la racine (et plus profonde).
ipcMain.handle('ark-delete-server', async (_evt, serverPath) => {
  const { rootFolder } = await arkManager.getOrAutoDetectRootFolder();
  if (!rootFolder) return { ok: false, error: i18n.t('err.arkRootNotFound') };
  try {
    processManager.forceStop(arkServerId(serverPath));
  } catch (e) {
    /* ignore */
  }
  const resolvedRoot = path.resolve(rootFolder);
  const target = path.resolve(serverPath);
  const rel = path.relative(resolvedRoot, target);
  if (rel.startsWith('..') || path.isAbsolute(rel) || !rel) {
    return { ok: false, error: i18n.t('err.pathOutsideRoot') };
  }
  try {
    fs.rmSync(target, { recursive: true, force: true });
    return { ok: true, deleted: target };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('ark-get-server-status', (_evt, serverPath) => processManager.getState(arkServerId(serverPath)));

ipcMain.handle('ark-send-command', (_evt, serverPath, command) =>
  processManager.sendCommand(arkServerId(serverPath), command)
);

// Commande RCON Ark : contrairement à la console stdin, RCON est le vrai canal
// d'administration des serveurs Ark (liste des joueurs, kick/ban, save…).
ipcMain.handle('ark-rcon', async (_evt, serverPath, command) => {
  const info = arkManager.getRconInfo(serverPath);
  if (!info.enabled) return { ok: false, error: i18n.t('rcon.disabled') };
  if (!info.password) return { ok: false, error: i18n.t('rcon.noPassword') };

  const r = await rconClient.rconCommand(info.host, info.port, info.password, command);
  if (r.ok) return r;

  const messages = {
    refused: i18n.t('rcon.refused'),
    timeout: i18n.t('rcon.timeout'),
    badPassword: i18n.t('rcon.badPassword'),
    socket: i18n.t('rcon.socket', { error: r.detail }),
  };
  return { ok: false, error: messages[r.error] || i18n.t('rcon.socket', { error: r.error }) };
});

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

// Assainit un nom de dossier de serveur : espaces et caractères spéciaux → « _ »
// (les chemins avec espaces cassent certains scripts de lancement).
function sanitizeFolderName(name) {
  return String(name || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'server';
}

function arkServerPath(parentFolder, edition, folderName) {
  const editionFolder = ARK_EDITION_FOLDER_NAMES[edition] || 'Autre';
  return path.join(parentFolder, editionFolder, sanitizeFolderName(folderName));
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
    return { ok: false, step: 'steamcmd', error: i18n.t('err.steamcmdNotInstalled') };
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
      error: i18n.t('err.steamcmdAlreadyRunning'),
    };
  }

  const appId = ARK_APP_IDS[edition];
  if (!appId) {
    return { ok: false, step: 'validation', error: i18n.t('err.arkUnknownEdition') };
  }
  if (!parentFolder || !folderName || !folderName.trim()) {
    return { ok: false, step: 'validation', error: i18n.t('err.arkMissingParams') };
  }

  // Rangé automatiquement dans un sous-dossier "ARK Survival Ascended" ou
  // "ARK Survival Evolved" selon l'édition choisie ; créé s'il n'existe pas
  // déjà (fs.mkdirSync récursif un peu plus bas s'en charge).
  const serverPath = arkServerPath(parentFolder, edition, folderName.trim());

  if (fs.existsSync(serverPath) && fs.readdirSync(serverPath).length > 0) {
    return { ok: false, step: 'validation', error: i18n.t('err.arkFolderExists', { name: sanitizeFolderName(folderName) }) };
  }

  try {
    fs.mkdirSync(serverPath, { recursive: true });
  } catch (e) {
    return { ok: false, step: 'folder', error: i18n.t('err.arkCreateFolder', { error: e.message }) };
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
      error: finalInstallState.errorMessage || i18n.t('err.arkInstallFailed'),
    };
  }

  const installedExe = arkManager.findServerExecutable(serverPath);
  if (!installedExe) {
    return {
      ok: false,
      step: 'install',
      error: i18n.t('err.arkInstallIncomplete'),
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
      error: i18n.t('err.arkEditionMismatch', {
        edition,
        exe: path.basename(installedExe),
        installedEdition,
        folder: sanitizeFolderName(folderName),
      }),
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
      error: i18n.t('err.steamcmdInstallRunning'),
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

// ---- Langue ----

// Le renderer (appsettings.js) synchronise la langue courante ici, au démarrage
// et à chaque changement, pour que les libellés natifs (zone de notification,
// boîtes de dialogue) et les messages d'erreur renvoyés soient dans la bonne langue.
ipcMain.handle('set-lang', (_evt, lang) => {
  const applied = i18n.setLang(lang);
  buildTrayMenu();
  return applied;
});

// ---- Mise à jour automatique (Phase E) ----

ipcMain.handle('update-get-status', () => autoUpdater.getStatus());
ipcMain.handle('update-check', () => autoUpdater.checkForUpdates());
ipcMain.handle('update-download', () => autoUpdater.downloadUpdate());
ipcMain.handle('update-install', () => autoUpdater.quitAndInstall());

// ---- Tableau de bord unifié des serveurs ----

function collectMinecraftServers() {
  const root = minecraftManager.getRootFolder();
  return root ? minecraftManager.listServers(root) : [];
}

async function collectArkServers() {
  try {
    const { rootFolder } = await arkManager.getOrAutoDetectRootFolder();
    return rootFolder ? arkManager.listServers(rootFolder) : [];
  } catch (e) {
    return [];
  }
}

// Liste unifiée de tous les serveurs (Minecraft, Ark, SteamCMD) avec leur statut.
ipcMain.handle('dashboard-list', async () => {
  const settings = appSettings.getSettings();
  const auto = settings.autoStartServers || {};
  const autoRestart = settings.autoRestartServers || {};
  const restartHours = settings.restartIntervalHours || {};
  const list = [];

  for (const s of collectMinecraftServers()) {
    const id = mcServerId(s.path);
    list.push({
      id, type: 'minecraft', name: s.name, path: s.path,
      status: processManager.getState(id).status,
      canStart: !!s.launchScript,
      launchScript: s.launchScript,
      launchScriptType: s.launchScriptType,
      autoStart: !!auto[id],
      autoRestart: !!autoRestart[id],
      restartHours: restartHours[id] || 0,
    });
  }

  for (const s of await collectArkServers()) {
    const id = arkServerId(s.path);
    list.push({
      id, type: 'ark', name: s.name, path: s.path,
      status: processManager.getState(id).status,
      canStart: !!s.executable,
      autoStart: !!auto[id],
      autoRestart: !!autoRestart[id],
      restartHours: restartHours[id] || 0,
    });
  }

  list.push({
    id: 'steamcmd', type: 'steamcmd', name: 'SteamCMD', path: null,
    status: processManager.getState('steamcmd').status,
    canStart: steamcmdManager.isInstalled(),
    autoStart: !!auto['steamcmd'],
  });

  return list;
});

// RAM/CPU (arbre de processus) des serveurs en cours d'exécution.
ipcMain.handle('dashboard-stats', async () => {
  const running = processManager.listTracked().filter(
    (t) => (t.status === 'running' || t.status === 'starting') && t.pid
  );
  if (running.length === 0) return {};

  const stats = await serverStats.getProcessTreeStats(running.map((t) => t.pid));
  const byId = {};
  for (const t of running) {
    const s = stats[String(t.pid)];
    if (s) byId[t.id] = s;
  }
  return byId;
});

function startServerFromDescriptor(server) {
  if (!server) return { ok: false, error: 'no server' };
  if (server.type === 'minecraft') {
    return launchMinecraftServer(server.path, server.launchScript, server.launchScriptType);
  }
  if (server.type === 'ark') {
    return launchArkServerProcess(server.path, arkManager.readLaunchConfig(server.path));
  }
  if (server.type === 'steamcmd') {
    return steamcmdManager.launch();
  }
  return { ok: false, error: 'unknown type' };
}

ipcMain.handle('dashboard-start', (_evt, server) => startServerFromDescriptor(server));

ipcMain.handle('dashboard-stop', (_evt, server) => {
  if (!server) return { ok: false };
  if (server.type === 'minecraft') return processManager.stopProcess(mcServerId(server.path), { graceful: true });
  if (server.type === 'ark') return processManager.stopProcess(arkServerId(server.path), { graceful: false });
  if (server.type === 'steamcmd') return steamcmdManager.stop();
  return { ok: false };
});

ipcMain.handle('dashboard-force-stop', (_evt, server) => {
  if (!server) return { ok: false };
  if (server.type === 'minecraft') return processManager.forceStop(mcServerId(server.path));
  if (server.type === 'ark') return processManager.forceStop(arkServerId(server.path));
  if (server.type === 'steamcmd') return steamcmdManager.forceStop();
  return { ok: false };
});

ipcMain.handle('dashboard-set-autostart', (_evt, id, enabled) => {
  const settings = appSettings.getSettings();
  const auto = { ...(settings.autoStartServers || {}) };
  if (enabled) auto[id] = true;
  else delete auto[id];
  appSettings.setSetting('autoStartServers', auto);
  return auto;
});

// Démarre automatiquement les serveurs marqués « auto-démarrage » (peu après le
// lancement de l'appli, pour laisser le système se stabiliser).
async function autoStartEnabledServers() {
  const auto = appSettings.getSettings().autoStartServers || {};
  if (!Object.values(auto).some(Boolean)) return;

  const mcRoot = minecraftManager.getRootFolder();
  if (mcRoot) {
    for (const s of minecraftManager.listServers(mcRoot)) {
      const id = mcServerId(s.path);
      if (auto[id] && s.launchScript && !processManager.isRunning(id)) {
        launchMinecraftServer(s.path, s.launchScript, s.launchScriptType);
      }
    }
  }

  for (const s of await collectArkServers()) {
    const id = arkServerId(s.path);
    if (auto[id] && s.executable && !processManager.isRunning(id)) {
      launchArkServerProcess(s.path, arkManager.readLaunchConfig(s.path));
    }
  }

  if (auto['steamcmd'] && steamcmdManager.isInstalled() && !processManager.isRunning('steamcmd')) {
    steamcmdManager.launch();
  }
}

// ---- Redémarrage auto au crash + redémarrages planifiés ----

function findServerDescriptorById(id) {
  if (id.startsWith('mc:')) {
    const p = id.slice(3);
    const root = minecraftManager.getRootFolder();
    const s = root ? minecraftManager.listServers(root).find((x) => x.path === p) : null;
    return s ? { type: 'minecraft', path: p, launchScript: s.launchScript, launchScriptType: s.launchScriptType } : null;
  }
  if (id.startsWith('ark:')) {
    return { type: 'ark', path: id.slice(4) };
  }
  return null;
}

function startServerById(id) {
  const d = findServerDescriptorById(id);
  if (!d) return;
  if (d.type === 'minecraft' && d.launchScript) {
    launchMinecraftServer(d.path, d.launchScript, d.launchScriptType);
  } else if (d.type === 'ark') {
    launchArkServerProcess(d.path, arkManager.readLaunchConfig(d.path));
  }
}

// Redémarrage propre planifié : arrêt gracieux, puis relance une fois arrêté.
function restartServerById(id) {
  const d = findServerDescriptorById(id);
  if (!d) return;
  if (!processManager.isRunning(id)) { startServerById(id); return; }

  if (d.type === 'minecraft') processManager.stopProcess(id, { graceful: true });
  else processManager.stopProcess(id, { graceful: false });

  const startedAt = Date.now();
  const iv = setInterval(() => {
    const st = processManager.getState(id).status;
    if (st === 'stopped' || st === 'error') {
      clearInterval(iv);
      setTimeout(() => startServerById(id), 3000);
    } else if (Date.now() - startedAt > 60000) {
      clearInterval(iv);
      processManager.forceStop(id);
      setTimeout(() => startServerById(id), 5000);
    }
  }, 2000);
}

// Anti-boucle : au plus 3 redémarrages auto en 10 min par serveur.
const restartHistory = {};
function canAutoRestart(id) {
  const now = Date.now();
  const arr = (restartHistory[id] || []).filter((t) => now - t < 600000);
  restartHistory[id] = arr;
  return arr.length < 3;
}

processManager.setCrashHandler((serverId) => {
  const auto = appSettings.getSettings().autoRestartServers || {};
  if (!auto[serverId]) return;
  if (!canAutoRestart(serverId)) return;
  restartHistory[serverId] = (restartHistory[serverId] || []).concat(Date.now());
  setTimeout(() => startServerById(serverId), 5000);
});

const restartTimers = {};
function rebuildRestartSchedules() {
  for (const k of Object.keys(restartTimers)) {
    clearInterval(restartTimers[k]);
    delete restartTimers[k];
  }
  const hoursMap = appSettings.getSettings().restartIntervalHours || {};
  for (const [id, hours] of Object.entries(hoursMap)) {
    const h = Number(hours);
    if (h > 0) restartTimers[id] = setInterval(() => restartServerById(id), h * 3600 * 1000);
  }
}

ipcMain.handle('dashboard-set-autorestart', (_evt, id, enabled) => {
  const s = appSettings.getSettings();
  const m = { ...(s.autoRestartServers || {}) };
  if (enabled) m[id] = true; else delete m[id];
  appSettings.setSetting('autoRestartServers', m);
  return m;
});

ipcMain.handle('dashboard-set-restart-interval', (_evt, id, hours) => {
  const s = appSettings.getSettings();
  const m = { ...(s.restartIntervalHours || {}) };
  const h = Number(hours) || 0;
  if (h > 0) m[id] = h; else delete m[id];
  appSettings.setSetting('restartIntervalHours', m);
  rebuildRestartSchedules();
  return m;
});
