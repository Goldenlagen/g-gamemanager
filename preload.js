'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  scanGames: (forceRescan) => ipcRenderer.invoke('scan-games', !!forceRescan),
  launchGame: (game) => ipcRenderer.invoke('launch-game', game),

  getManualGames: () => ipcRenderer.invoke('get-manual-games'),
  addManualGame: () => ipcRenderer.invoke('add-manual-game'),
  confirmManualGame: (name, exePath) => ipcRenderer.invoke('confirm-manual-game', { name, exePath }),
  removeManualGame: (exePath) => ipcRenderer.invoke('remove-manual-game', exePath),

  getStartupEnabled: () => ipcRenderer.invoke('get-startup-enabled'),
  setStartupEnabled: (enabled) => ipcRenderer.invoke('set-startup-enabled', enabled),

  minimizeToTray: () => ipcRenderer.invoke('minimize-to-tray'),
  quitApp: () => ipcRenderer.invoke('quit-app'),

  // Serveurs Minecraft
  mcGetRootFolder: () => ipcRenderer.invoke('mc-get-root-folder'),
  mcChooseRootFolder: () => ipcRenderer.invoke('mc-choose-root-folder'),
  mcListServers: () => ipcRenderer.invoke('mc-list-servers'),
  mcReadProperties: (serverPath) => ipcRenderer.invoke('mc-read-properties', serverPath),
  mcWriteProperties: (serverPath, updates) => ipcRenderer.invoke('mc-write-properties', serverPath, updates),
  mcReadLaunchArgs: (serverPath) => ipcRenderer.invoke('mc-read-launch-args', serverPath),
  mcWriteLaunchArgs: (serverPath, argsText) => ipcRenderer.invoke('mc-write-launch-args', serverPath, argsText),
  mcLaunchServer: (serverPath, launchScript, launchScriptType) =>
    ipcRenderer.invoke('mc-launch-server', serverPath, launchScript, launchScriptType),
  mcStopServer: (serverPath) => ipcRenderer.invoke('mc-stop-server', serverPath),
  mcForceStopServer: (serverPath) => ipcRenderer.invoke('mc-force-stop-server', serverPath),
  mcGetServerStatus: (serverPath) => ipcRenderer.invoke('mc-get-server-status', serverPath),
  mcSendCommand: (serverPath, command) => ipcRenderer.invoke('mc-send-command', serverPath, command),

  // CurseForge (modpacks)
  cfSearchModpacks: (opts) => ipcRenderer.invoke('cf-search-modpacks', opts),
  cfGetCategories: () => ipcRenderer.invoke('cf-get-categories'),
  cfGetModpackFiles: (modId) => ipcRenderer.invoke('cf-get-modpack-files', modId),
  cfInstallProfile: (opts) => ipcRenderer.invoke('cf-install-profile', opts),
  cfDownloadServerpack: (opts) => ipcRenderer.invoke('cf-download-serverpack', opts),
  cfGetInstalledServerpacks: () => ipcRenderer.invoke('cf-get-installed-serverpacks'),
  onCfDownloadProgress: (callback) => {
    const listener = (_evt, data) => callback(data);
    ipcRenderer.on('cf-download-progress', listener);
    return () => ipcRenderer.removeListener('cf-download-progress', listener);
  },

  // Profils Minecraft (launcher officiel)
  mcpListProfiles: () => ipcRenderer.invoke('mcp-list-profiles'),
  mcpGetInstalledModpacks: () => ipcRenderer.invoke('mcp-get-installed-modpacks'),
  mcpOpenPath: (targetPath) => ipcRenderer.invoke('mcp-open-path', targetPath),
  mcpPlayProfile: (profileKey) => ipcRenderer.invoke('mcp-play-profile', profileKey),
  mcpUninstallProfile: (profileKey) => ipcRenderer.invoke('mcp-uninstall-profile', profileKey),

  // Serveurs Ark
  arkGetRootFolder: () => ipcRenderer.invoke('ark-get-root-folder'),
  arkChooseRootFolder: () => ipcRenderer.invoke('ark-choose-root-folder'),
  arkListServers: () => ipcRenderer.invoke('ark-list-servers'),
  arkGetKnownMaps: () => ipcRenderer.invoke('ark-get-known-maps'),
  arkReadSettings: (serverPath) => ipcRenderer.invoke('ark-read-settings', serverPath),
  arkWriteSettings: (serverPath, updates) => ipcRenderer.invoke('ark-write-settings', serverPath, updates),
  arkReadLaunchConfig: (serverPath) => ipcRenderer.invoke('ark-read-launch-config', serverPath),
  arkWriteLaunchConfig: (serverPath, config) => ipcRenderer.invoke('ark-write-launch-config', serverPath, config),
  arkLaunchServer: (serverPath, config) => ipcRenderer.invoke('ark-launch-server', serverPath, config),
  arkStopServer: (serverPath) => ipcRenderer.invoke('ark-stop-server', serverPath),
  arkForceStopServer: (serverPath) => ipcRenderer.invoke('ark-force-stop-server', serverPath),
  arkGetServerStatus: (serverPath) => ipcRenderer.invoke('ark-get-server-status', serverPath),
  arkSendCommand: (serverPath, command) => ipcRenderer.invoke('ark-send-command', serverPath, command),
  arkGenerateScript: (serverPath, config) => ipcRenderer.invoke('ark-generate-script', serverPath, config),
  arkGetInstallProgress: (parentFolder, folderName, edition) => ipcRenderer.invoke('ark-get-install-progress', parentFolder, folderName, edition),
  arkCreateAndLaunchServer: (options) => ipcRenderer.invoke('ark-create-and-launch-server', options),

  // SteamCMD
  steamcmdIsInstalled: () => ipcRenderer.invoke('steamcmd-is-installed'),
  steamcmdDownload: () => ipcRenderer.invoke('steamcmd-download'),
  steamcmdReset: () => ipcRenderer.invoke('steamcmd-reset'),
  steamcmdLaunch: () => ipcRenderer.invoke('steamcmd-launch'),
  steamcmdStop: () => ipcRenderer.invoke('steamcmd-stop'),
  steamcmdForceStop: () => ipcRenderer.invoke('steamcmd-force-stop'),
  steamcmdSendCommand: (command) => ipcRenderer.invoke('steamcmd-send-command', command),
  steamcmdGetStatus: () => ipcRenderer.invoke('steamcmd-get-status'),

  // Performance
  perfGetSnapshot: () => ipcRenderer.invoke('perf-get-snapshot'),

  // Réglages
  settingsGet: () => ipcRenderer.invoke('settings-get'),
  settingsSet: (key, value) => ipcRenderer.invoke('settings-set', key, value),

  // Console/statut des serveurs en direct : les callbacks reçoivent { serverId, ... }.
  // Retourne une fonction de désabonnement.
  onServerLog: (callback) => {
    const listener = (_evt, data) => callback(data);
    ipcRenderer.on('server-log', listener);
    return () => ipcRenderer.removeListener('server-log', listener);
  },
  onServerStatus: (callback) => {
    const listener = (_evt, data) => callback(data);
    ipcRenderer.on('server-status', listener);
    return () => ipcRenderer.removeListener('server-status', listener);
  },
});
