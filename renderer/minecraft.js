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
    launchScriptInfo: document.getElementById('mcLaunchScriptInfo'),
    propertiesForm: document.getElementById('mcPropertiesForm'),
    savePropertiesBtn: document.getElementById('mcSavePropertiesBtn'),
    propertiesSaveStatus: document.getElementById('mcPropertiesSaveStatus'),
    jvmArgsHint: document.getElementById('mcJvmArgsHint'),
    jvmArgsTextarea: document.getElementById('mcJvmArgsTextarea'),
    saveArgsBtn: document.getElementById('mcSaveArgsBtn'),
    argsSaveStatus: document.getElementById('mcArgsSaveStatus'),
  };

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
    el.consoleOutput.innerHTML = '<div class="console-empty">Aucune sortie pour le moment. Lance le serveur pour voir la console ici.</div>';
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
      el.launchScriptInfo.textContent = `Script détecté : ${server.launchScript}`;
    } else {
      el.launchBtn.disabled = true;
      el.launchScriptInfo.textContent = 'Aucun script .ps1/.bat détecté dans ce dossier.';
    }

    const current = await window.api.mcGetServerStatus(server.path);
    applyStatus(current);
    if (current.logLines && current.logLines.length > 0) appendConsoleLines(current.logLines);
    if (server.launchScript) el.launchBtn.disabled = current.status === 'running' || current.status === 'starting';

    const { values } = await window.api.mcReadProperties(server.path);
    renderPropertiesForm(values);

    const argsInfo = await window.api.mcReadLaunchArgs(server.path);
    el.jvmArgsTextarea.value = argsInfo.argsText.split('\n').filter(Boolean).join(' ');
    el.jvmArgsHint.textContent = argsInfo.exists
      ? 'Fichier user_jvm_args.txt détecté : ces arguments seront utilisés si ton script le référence (java @user_jvm_args.txt -jar server.jar nogui).'
      : "Aucun user_jvm_args.txt pour l'instant : il sera créé à l'enregistrement. Assure-toi que ton script de lancement contient bien : java @user_jvm_args.txt -jar server.jar nogui";
  }

  function closeDetail() {
    state.currentServer = null;
    el.serverDetail.style.display = 'none';
    el.serverList.style.display = 'flex';
  }

  function renderServerList() {
    el.serverList.innerHTML = '';
    state.cardDots.clear();

    if (!state.rootFolder) {
      el.emptyState.textContent = 'Sélectionne le dossier contenant tes serveurs Minecraft pour commencer.';
      el.emptyState.style.display = 'flex';
      return;
    }

    if (state.servers.length === 0) {
      el.emptyState.textContent = 'Aucun serveur Minecraft détecté dans ce dossier.';
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
        server.launchScript ? `Script : ${server.launchScript}` : 'Aucun script détecté',
        server.hasProperties ? 'server.properties trouvé' : 'server.properties absent',
      ].join('<br>');

      card.appendChild(title);
      card.appendChild(meta);
      card.addEventListener('click', () => { window.GameSounds?.navigate(); openDetail(server); });

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

    el.rootFolderLabel.textContent = state.rootFolder || 'Aucun dossier sélectionné';
    renderServerList();
  }

  el.chooseFolderBtn.addEventListener('click', async () => {
    window.GameSounds?.toggle();
    const folder = await window.api.mcChooseRootFolder();
    if (folder) await refreshList();
  });

  el.refreshBtn.addEventListener('click', () => { window.GameSounds?.toggle(); refreshList(); });
  el.backBtn.addEventListener('click', () => { window.GameSounds?.back(); closeDetail(); });

  el.savePropertiesBtn.addEventListener('click', async () => {
    if (!state.currentServer) return;
    const updates = collectPropertiesUpdates();
    const values = await window.api.mcWriteProperties(state.currentServer.path, updates);
    renderPropertiesForm(values);
    window.GameSounds?.confirm();
    showStatus(el.propertiesSaveStatus, 'Enregistré ✓');
  });

  el.saveArgsBtn.addEventListener('click', async () => {
    if (!state.currentServer) return;
    const argsInfo = await window.api.mcWriteLaunchArgs(state.currentServer.path, el.jvmArgsTextarea.value);
    el.jvmArgsTextarea.value = argsInfo.argsText.split('\n').filter(Boolean).join(' ');
    el.jvmArgsHint.textContent =
      'Fichier user_jvm_args.txt mis à jour : ces arguments seront utilisés si ton script le référence (java @user_jvm_args.txt -jar server.jar nogui).';
    window.GameSounds?.confirm();
    showStatus(el.argsSaveStatus, 'Enregistré ✓');
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
      el.launchScriptInfo.textContent = `Erreur au lancement : ${result.error}`;
    } else {
      el.launchScriptInfo.textContent = `Script lancé : ${state.currentServer.launchScript}`;
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
      el.stopWarningBanner.textContent =
        "⏳ Le serveur ne s'est pas encore arrêté après 25 secondes. S'il est bloqué (ex: demande d'appuyer sur Ctrl+C), tu peux utiliser « Forcer l'arrêt » ci-dessus — mais attention, les données non sauvegardées seront perdues.";
      el.stopWarningBanner.style.display = 'block';
    }, 25000);
  });

  el.forceStopBtn.addEventListener('click', async () => {
    if (!state.currentServer) return;
    const confirmed = confirm(
      "Forcer l'arrêt va tuer immédiatement le serveur (script + Java), sans lui laisser le temps de sauvegarder. Continuer ?"
    );
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
  };
})();
