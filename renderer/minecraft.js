'use strict';

(function () {
  const state = {
    rootFolder: null,
    servers: [],
    currentServer: null, // { id, name, path, hasProperties, launchScript, launchScriptType }
    loaded: false,
    cardDots: new Map(), // serverPath -> élément .status-dot de la carte dans la liste
    stopTimeoutId: null,
  };

  const el = {
    rootFolderLabel: document.getElementById('mcRootFolderLabel'),
    chooseFolderBtn: document.getElementById('mcChooseFolderBtn'),
    refreshBtn: document.getElementById('mcRefreshBtn'),
    serverList: document.getElementById('mcServerList'),
    emptyState: document.getElementById('mcEmptyState'),
    serverDetail: document.getElementById('mcServerDetail'),
    backBtn: document.getElementById('mcBackBtn'),
    detailName: document.getElementById('mcDetailName'),
    statusDot: document.getElementById('mcStatusDot'),
    errorBanner: document.getElementById('mcErrorBanner'),
    stopWarningBanner: document.getElementById('mcStopWarningBanner'),
    consoleOutput: document.getElementById('mcConsoleOutput'),
    commandInput: document.getElementById('mcCommandInput'),
    sendCommandBtn: document.getElementById('mcSendCommandBtn'),
    launchBtn: document.getElementById('mcLaunchBtn'),
    stopBtn: document.getElementById('mcStopBtn'),
    forceStopBtn: document.getElementById('mcForceStopBtn'),
    deleteBtn: document.getElementById('mcDeleteBtn'),
    launchScriptInfo: document.getElementById('mcLaunchScriptInfo'),
    propertiesForm: document.getElementById('mcPropertiesForm'),
    savePropertiesBtn: document.getElementById('mcSavePropertiesBtn'),
    propertiesSaveStatus: document.getElementById('mcPropertiesSaveStatus'),
    jvmArgsHint: document.getElementById('mcJvmArgsHint'),
    jvmArgsTextarea: document.getElementById('mcJvmArgsTextarea'),
    saveArgsBtn: document.getElementById('mcSaveArgsBtn'),
    argsSaveStatus: document.getElementById('mcArgsSaveStatus'),
    whitelistList: document.getElementById('mcWhitelistList'),
    opsList: document.getElementById('mcOpsList'),
    bansList: document.getElementById('mcBansList'),
    whitelistInput: document.getElementById('mcWhitelistInput'),
    opsInput: document.getElementById('mcOpsInput'),
    bansInput: document.getElementById('mcBansInput'),
    whitelistAddBtn: document.getElementById('mcWhitelistAddBtn'),
    opsAddBtn: document.getElementById('mcOpsAddBtn'),
    bansAddBtn: document.getElementById('mcBansAddBtn'),
    shareRow: document.getElementById('mcShareRow'),
    shareAddress: document.getElementById('mcShareAddress'),
    shareCopyBtn: document.getElementById('mcShareCopyBtn'),
    shareNoHamachi: document.getElementById('mcShareNoHamachi'),
    backupCreateBtn: document.getElementById('mcBackupCreateBtn'),
    backupStatus: document.getElementById('mcBackupStatus'),
    backupList: document.getElementById('mcBackupList'),
    playersCount: document.getElementById('mcPlayersCount'),
    playersRefreshBtn: document.getElementById('mcPlayersRefreshBtn'),
    playersList: document.getElementById('mcPlayersList'),
  };

  // Traduction (repli sur la clé si absente).
  function tr(key, params) {
    const v = window.AppSettings ? window.AppSettings.t(key, params) : null;
    return v != null ? v : key;
  }

  // Doit correspondre exactement à mcServerId() côté processus principal (main.js),
  // pour que les évènements de console/statut relayés soient bien rattachés au bon serveur.
  function serverId(serverPath) {
    return `mc:${serverPath}`;
  }

  function clearStopWarning() {
    if (state.stopTimeoutId) {
      clearTimeout(state.stopTimeoutId);
      state.stopTimeoutId = null;
    }
    el.stopWarningBanner.style.display = 'none';
  }

  function applyStatus({ status, errorMessage }) {
    el.statusDot.className = `status-dot status-${status}`;

    const running = status === 'running' || status === 'starting';
    el.launchBtn.disabled = running;
    el.stopBtn.disabled = !running;
    el.forceStopBtn.disabled = !running;

    const canSendCommand = status === 'running';
    el.commandInput.disabled = !canSendCommand;
    el.sendCommandBtn.disabled = !canSendCommand;

    if (!running) clearStopWarning();

    if (errorMessage) {
      el.errorBanner.textContent = `⚠ ${errorMessage}`;
      el.errorBanner.style.display = 'block';
    } else {
      el.errorBanner.style.display = 'none';
    }
  }

  function appendConsoleLines(lines) {
    if (!lines || lines.length === 0) return;
    el.consoleOutput.querySelector('.console-empty')?.remove();

    for (const line of lines) {
      const div = document.createElement('div');
      div.textContent = line;
      el.consoleOutput.appendChild(div);
    }
    el.consoleOutput.scrollTop = el.consoleOutput.scrollHeight;
  }

  function resetConsole() {
    const div = document.createElement('div');
    div.className = 'console-empty';
    div.textContent = tr('server.consoleEmpty');
    el.consoleOutput.innerHTML = '';
    el.consoleOutput.appendChild(div);
  }

  // Abonnement global unique : on filtre par serveur actuellement ouvert.
  window.api.onServerLog(({ serverId: id, lines }) => {
    if (state.currentServer && serverId(state.currentServer.path) === id) appendConsoleLines(lines);
  });

  window.api.onServerStatus(({ serverId: id, status, errorMessage }) => {
    // Met à jour la carte correspondante dans la liste, qu'elle soit affichée ou non.
    for (const [path, dot] of state.cardDots) {
      if (serverId(path) === id) dot.className = `status-dot status-${status}`;
    }
    // Met à jour la fiche détail si c'est bien le serveur actuellement ouvert.
    if (state.currentServer && serverId(state.currentServer.path) === id) applyStatus({ status, errorMessage });
  });

  function showStatus(elm, text) {
    elm.textContent = text;
    setTimeout(() => { if (elm.textContent === text) elm.textContent = ''; }, 3000);
  }

  function fieldTypeFor(value) {
    if (value === 'true' || value === 'false') return 'boolean';
    if (/^-?\d+(\.\d+)?$/.test(value)) return 'number';
    return 'text';
  }

  function renderPropertiesForm(values) {
    el.propertiesForm.innerHTML = '';

    const keys = Object.keys(values).sort((a, b) => a.localeCompare(b));
    for (const key of keys) {
      const value = values[key];
      const type = fieldTypeFor(value);
      const label = document.createElement('label');

      if (type === 'boolean') {
        label.className = 'checkbox-field';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = value === 'true';
        checkbox.dataset.key = key;
        label.appendChild(checkbox);
        const span = document.createElement('span');
        span.textContent = key;
        label.appendChild(span);
      } else {
        const span = document.createElement('span');
        span.textContent = key;
        label.appendChild(span);
        const input = document.createElement('input');
        input.type = type === 'number' ? 'number' : 'text';
        input.value = value;
        input.dataset.key = key;
        label.appendChild(input);
      }

      el.propertiesForm.appendChild(label);
    }
  }

  function collectPropertiesUpdates() {
    const updates = {};
    el.propertiesForm.querySelectorAll('[data-key]').forEach((field) => {
      const key = field.dataset.key;
      updates[key] = field.type === 'checkbox' ? String(field.checked) : String(field.value);
    });
    return updates;
  }

  async function openDetail(server) {
    state.currentServer = server;
    el.serverList.style.display = 'none';
    el.emptyState.style.display = 'none';
    el.serverDetail.style.display = 'block';
    el.detailName.textContent = server.name;
    resetConsole();
    clearStopWarning();

    if (server.launchScript) {
      el.launchScriptInfo.textContent = tr('mc.scriptDetected', { script: server.launchScript });
    } else {
      el.launchBtn.disabled = true;
      el.launchScriptInfo.textContent = tr('mc.noScript');
    }

    const current = await window.api.mcGetServerStatus(server.path);
    applyStatus(current);
    if (current.logLines && current.logLines.length > 0) appendConsoleLines(current.logLines);
    if (server.launchScript) el.launchBtn.disabled = current.status === 'running' || current.status === 'starting';

    const { values } = await window.api.mcReadProperties(server.path);
    renderPropertiesForm(values);

    const argsInfo = await window.api.mcReadLaunchArgs(server.path);
    el.jvmArgsTextarea.value = argsInfo.argsText.split('\n').filter(Boolean).join(' ');
    el.jvmArgsHint.textContent = argsInfo.exists ? tr('mc.jvmExists') : tr('mc.jvmMissing');

    loadAccessLists();
    loadShareInfo();
    loadBackups();
    startPlayersPolling();
  }

  // ---------- Joueurs en ligne ----------

  function startPlayersPolling() {
    stopPlayersPolling();
    loadPlayers();
    state.playersTimer = setInterval(loadPlayers, 15000);
  }

  function stopPlayersPolling() {
    if (state.playersTimer) {
      clearInterval(state.playersTimer);
      state.playersTimer = null;
    }
  }

  async function loadPlayers() {
    if (!state.currentServer) return;
    const res = await window.api.mcListPlayers(state.currentServer.path);
    if (!res || !res.running) {
      el.playersCount.textContent = tr('mc.playersOffline');
      el.playersList.innerHTML = '';
      return;
    }
    el.playersCount.textContent = tr('mc.playersOnline', { count: res.count });
    el.playersList.innerHTML = '';
    if (res.players && res.players.length) {
      for (const p of res.players) {
        const chip = document.createElement('span');
        chip.className = 'mc-player-chip';
        chip.textContent = p;
        el.playersList.appendChild(chip);
      }
    } else {
      const none = document.createElement('p');
      none.className = 'hint-text';
      none.textContent = tr('mc.playersNone');
      el.playersList.appendChild(none);
    }
  }

  el.playersRefreshBtn.addEventListener('click', () => { window.GameSounds?.toggle(); loadPlayers(); });

  // ---------- Sauvegardes du monde ----------

  function fmtBytes(b) {
    if (!b) return '0 ' + tr('units.mb');
    const gb = b / (1024 * 1024 * 1024);
    if (gb >= 1) return gb.toFixed(1) + ' ' + tr('units.gb');
    return (b / (1024 * 1024)).toFixed(0) + ' ' + tr('units.mb');
  }

  function renderBackups(list) {
    el.backupList.innerHTML = '';
    if (!list || list.length === 0) {
      const p = document.createElement('p');
      p.className = 'hint-text';
      p.textContent = tr('mc.backupsEmpty');
      el.backupList.appendChild(p);
      return;
    }
    const loc = window.AppSettings && window.AppSettings.getLang() === 'en' ? 'en-GB' : 'fr-FR';
    for (const b of list) {
      const row = document.createElement('div');
      row.className = 'mc-backup-row';

      const info = document.createElement('div');
      info.className = 'mc-backup-info';
      const nm = document.createElement('span');
      nm.className = 'mc-backup-name';
      nm.textContent = b.name;
      const meta = document.createElement('span');
      meta.className = 'mc-backup-meta';
      meta.textContent = `${new Date(b.mtimeMs).toLocaleString(loc)} · ${fmtBytes(b.sizeBytes)}`;
      info.appendChild(nm);
      info.appendChild(meta);

      const actions = document.createElement('div');
      actions.className = 'mc-backup-actions';
      const restore = document.createElement('button');
      restore.className = 'secondary';
      restore.textContent = tr('mc.backupRestore');
      restore.addEventListener('click', async () => {
        if (!confirm(tr('mc.backupRestoreConfirm', { name: b.name }))) return;
        restore.disabled = true;
        const res = await window.api.mcBackupRestore(state.currentServer.path, b.name);
        if (res && res.backups) renderBackups(res.backups);
        if (res) showStatus(el.backupStatus, res.ok ? tr('mc.backupRestored') : res.error);
      });
      const del = document.createElement('button');
      del.className = 'danger';
      del.textContent = tr('common.remove');
      del.addEventListener('click', async () => {
        if (!confirm(tr('mc.backupDeleteConfirm', { name: b.name }))) return;
        const res = await window.api.mcBackupDelete(state.currentServer.path, b.name);
        if (res && res.backups) renderBackups(res.backups);
      });
      actions.appendChild(restore);
      actions.appendChild(del);

      row.appendChild(info);
      row.appendChild(actions);
      el.backupList.appendChild(row);
    }
  }

  async function loadBackups() {
    if (!state.currentServer) return;
    const list = await window.api.mcBackupList(state.currentServer.path);
    renderBackups(list);
  }

  el.backupCreateBtn.addEventListener('click', async () => {
    if (!state.currentServer) return;
    window.GameSounds?.confirm();
    el.backupCreateBtn.disabled = true;
    showStatus(el.backupStatus, tr('mc.backupCreating'));
    const res = await window.api.mcBackupCreate(state.currentServer.path);
    el.backupCreateBtn.disabled = false;
    if (res) {
      if (res.backups) renderBackups(res.backups);
      showStatus(el.backupStatus, res.ok ? tr('mc.backupDone') : res.error);
    }
  });

  // ---------- Partage (Hamachi) ----------

  async function loadShareInfo() {
    if (!state.currentServer) return;
    const info = await window.api.mcShareInfo(state.currentServer.path);
    if (info && info.hamachiIp) {
      el.shareAddress.textContent = `${info.hamachiIp}:${info.port}`;
      el.shareRow.style.display = 'flex';
      el.shareNoHamachi.style.display = 'none';
    } else {
      el.shareRow.style.display = 'none';
      el.shareNoHamachi.style.display = 'block';
    }
  }

  el.shareCopyBtn.addEventListener('click', async () => {
    const text = el.shareAddress.textContent;
    if (!text || text === '—') return;
    try {
      await navigator.clipboard.writeText(text);
      window.GameSounds?.confirm();
      const original = el.shareCopyBtn.textContent;
      el.shareCopyBtn.textContent = tr('mc.shareCopied');
      setTimeout(() => { el.shareCopyBtn.textContent = original; }, 1500);
    } catch (e) { /* clipboard indisponible */ }
  });

  // ---------- Listes d'accès (whitelist / ops / bans) ----------

  function renderAccessCol(container, list, entries) {
    container.innerHTML = '';
    if (!entries || entries.length === 0) {
      const p = document.createElement('p');
      p.className = 'hint-text';
      p.textContent = tr('mc.accessEmpty');
      container.appendChild(p);
      return;
    }
    for (const e of entries) {
      const row = document.createElement('div');
      row.className = 'mc-access-row';
      const name = document.createElement('span');
      name.className = 'mc-access-name';
      name.textContent = e.name || e.uuid || '?';
      name.title = e.uuid || '';
      const rm = document.createElement('button');
      rm.className = 'secondary';
      rm.textContent = tr('common.remove');
      rm.addEventListener('click', async () => {
        if (!state.currentServer) return;
        window.GameSounds?.back();
        rm.disabled = true;
        const res = await window.api.mcAccessRemove(state.currentServer.path, list, e.name);
        if (res && res.lists) renderAccessLists(res.lists);
      });
      row.appendChild(name);
      row.appendChild(rm);
      container.appendChild(row);
    }
  }

  function renderAccessLists(lists) {
    renderAccessCol(el.whitelistList, 'whitelist', lists.whitelist);
    renderAccessCol(el.opsList, 'ops', lists.ops);
    renderAccessCol(el.bansList, 'bans', lists.bans);
  }

  async function loadAccessLists() {
    if (!state.currentServer) return;
    const lists = await window.api.mcAccessList(state.currentServer.path);
    if (lists) renderAccessLists(lists);
  }

  async function addAccess(list, input) {
    if (!state.currentServer) return;
    const name = input.value.trim();
    if (!name) return;
    input.value = '';
    window.GameSounds?.confirm();
    const res = await window.api.mcAccessAdd(state.currentServer.path, list, name);
    if (res && res.lists) renderAccessLists(res.lists);
  }

  el.whitelistAddBtn.addEventListener('click', () => addAccess('whitelist', el.whitelistInput));
  el.opsAddBtn.addEventListener('click', () => addAccess('ops', el.opsInput));
  el.bansAddBtn.addEventListener('click', () => addAccess('bans', el.bansInput));
  el.whitelistInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addAccess('whitelist', el.whitelistInput); });
  el.opsInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addAccess('ops', el.opsInput); });
  el.bansInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addAccess('bans', el.bansInput); });

  function closeDetail() {
    state.currentServer = null;
    stopPlayersPolling();
    el.serverDetail.style.display = 'none';
    el.serverList.style.display = 'flex';
  }

  function renderServerList() {
    el.serverList.innerHTML = '';
    state.cardDots.clear();

    if (!state.rootFolder) {
      el.emptyState.textContent = tr('mc.empty');
      el.emptyState.style.display = 'flex';
      return;
    }

    if (state.servers.length === 0) {
      el.emptyState.textContent = tr('mc.noServers');
      el.emptyState.style.display = 'flex';
      return;
    }

    el.emptyState.style.display = 'none';

    for (const server of state.servers) {
      const card = document.createElement('div');
      card.className = 'server-card';

      const title = document.createElement('h4');
      title.title = server.name;
      const dot = document.createElement('span');
      dot.className = 'status-dot status-stopped';
      state.cardDots.set(server.path, dot);
      title.appendChild(dot);
      title.appendChild(document.createTextNode(server.name));

      const meta = document.createElement('div');
      meta.className = 'server-card-meta';
      meta.innerHTML = [
        server.launchScript ? tr('mc.metaScript', { script: server.launchScript }) : tr('mc.metaNoScript'),
        server.hasProperties ? tr('mc.propsFound') : tr('mc.propsAbsent'),
      ].join('<br>');

      card.appendChild(title);
      card.appendChild(meta);
      card.addEventListener('click', () => { window.GameSounds?.serverItem(); openDetail(server); });

      el.serverList.appendChild(card);

      window.api.mcGetServerStatus(server.path).then(({ status }) => {
        dot.className = `status-dot status-${status}`;
      });
    }
  }

  async function refreshList() {
    const result = await window.api.mcListServers();
    state.rootFolder = result.rootFolder;
    state.servers = result.servers;

    el.rootFolderLabel.textContent = state.rootFolder || tr('common.noFolder');
    renderServerList();
  }

  el.chooseFolderBtn.addEventListener('click', async () => {
    window.GameSounds?.toggle();
    const folder = await window.api.mcChooseRootFolder();
    if (folder) await refreshList();
  });

  el.refreshBtn.addEventListener('click', () => { window.GameSounds?.toggle(); refreshList(); });
  el.backBtn.addEventListener('click', () => { window.GameSounds?.back(); closeDetail(); });

  el.deleteBtn.addEventListener('click', async () => {
    if (!state.currentServer) return;
    const s = state.currentServer;
    const confirmed = confirm(tr('mc.confirmDelete', { name: s.name }));
    if (!confirmed) return;
    window.GameSounds?.back();
    el.deleteBtn.disabled = true;
    const res = await window.api.mcDeleteServer(s.path);
    el.deleteBtn.disabled = false;
    if (res && res.ok) {
      closeDetail();
      refreshList();
    } else {
      el.errorBanner.textContent = `⚠ ${(res && res.error) || tr('common.deleteFailed')}`;
      el.errorBanner.style.display = 'block';
    }
  });

  el.savePropertiesBtn.addEventListener('click', async () => {
    if (!state.currentServer) return;
    const updates = collectPropertiesUpdates();
    const values = await window.api.mcWriteProperties(state.currentServer.path, updates);
    renderPropertiesForm(values);
    window.GameSounds?.confirm();
    showStatus(el.propertiesSaveStatus, tr('common.saved'));
  });

  el.saveArgsBtn.addEventListener('click', async () => {
    if (!state.currentServer) return;
    const argsInfo = await window.api.mcWriteLaunchArgs(state.currentServer.path, el.jvmArgsTextarea.value);
    el.jvmArgsTextarea.value = argsInfo.argsText.split('\n').filter(Boolean).join(' ');
    el.jvmArgsHint.textContent = tr('mc.jvmUpdated');
    window.GameSounds?.confirm();
    showStatus(el.argsSaveStatus, tr('common.saved'));
  });

  el.launchBtn.addEventListener('click', async () => {
    if (!state.currentServer || !state.currentServer.launchScript) return;
    window.GameSounds?.confirm();
    resetConsole();
    const result = await window.api.mcLaunchServer(
      state.currentServer.path,
      state.currentServer.launchScript,
      state.currentServer.launchScriptType
    );
    if (!result.ok) {
      el.launchScriptInfo.textContent = `${tr('server.launchErrorLabel')} ${result.error}`;
    } else {
      el.launchScriptInfo.textContent = tr('mc.scriptLaunched', { script: state.currentServer.launchScript });
    }
    // Le statut définitif (running / error / crashed) arrive de façon asynchrone
    // via l'évènement onServerStatus, capté plus haut.
  });

  el.stopBtn.addEventListener('click', async () => {
    if (!state.currentServer) return;
    window.GameSounds?.back();
    clearStopWarning();
    await window.api.mcStopServer(state.currentServer.path);

    // Si le serveur ne s'est pas réellement arrêté après un délai raisonnable
    // (script bloqué, demande de Ctrl+C, etc.), on le signale plutôt que de
    // forcer automatiquement — l'arrêt forcé ne sauvegarde pas les données,
    // donc la décision doit rester entre tes mains.
    state.stopTimeoutId = setTimeout(() => {
      el.stopWarningBanner.textContent = tr('mc.stopWarning');
      el.stopWarningBanner.style.display = 'block';
    }, 25000);
  });

  el.forceStopBtn.addEventListener('click', async () => {
    if (!state.currentServer) return;
    const confirmed = confirm(tr('mc.forceStopConfirm'));
    if (!confirmed) return;

    window.GameSounds?.back();
    await window.api.mcForceStopServer(state.currentServer.path);
  });

  async function sendCommand() {
    if (!state.currentServer) return;
    const command = el.commandInput.value.trim();
    if (!command) return;

    const line = document.createElement('div');
    line.className = 'console-line-command';
    line.textContent = `> ${command}`;
    el.consoleOutput.querySelector('.console-empty')?.remove();
    el.consoleOutput.appendChild(line);
    el.consoleOutput.scrollTop = el.consoleOutput.scrollHeight;

    el.commandInput.value = '';
    const result = await window.api.mcSendCommand(state.currentServer.path, command);
    if (!result.ok) {
      const errLine = document.createElement('div');
      errLine.className = 'console-line-error';
      errLine.textContent = `⚠ ${result.error}`;
      el.consoleOutput.appendChild(errLine);
    }
  }

  el.sendCommandBtn.addEventListener('click', sendCommand);
  el.commandInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendCommand();
  });

  // Retraduit les libellés construits en JS quand la langue change.
  document.addEventListener('gg-langchange', () => {
    if (!state.loaded) return;
    refreshList();
    const emptyLine = el.consoleOutput.querySelector('.console-empty');
    if (emptyLine) emptyLine.textContent = tr('server.consoleEmpty');
  });

  window.MinecraftPanel = {
    onShow() {
      if (state.loaded) return;
      state.loaded = true;
      refreshList();
    },
    // Rafraîchit la liste des serveurs (utilisé après un téléchargement de
    // modpack CurseForge pour faire apparaître le nouveau dossier).
    refresh() {
      state.loaded = true;
      return refreshList();
    },
    // Dossier racine Minecraft courant (null si non configuré).
    getRootFolder() {
      return state.rootFolder;
    },
    // Ouvre directement la fiche détail d'un serveur par son chemin (depuis le dashboard).
    async openByPath(path) {
      state.loaded = true;
      await refreshList();
      const server = state.servers.find((s) => s.path === path);
      if (server) openDetail(server);
    },
  };
})();
