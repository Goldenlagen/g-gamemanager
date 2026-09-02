'use strict';

(function () {
  const COMMON_SETTINGS = [
    { key: 'ServerPVE', label: 'Mode PvE (pas de combat JcJ)', type: 'boolean' },
    { key: 'ServerHardcore', label: 'Mode Hardcore', type: 'boolean' },
    { key: 'AllowThirdPersonPlayer', label: 'Vue à la troisième personne autorisée', type: 'boolean' },
    { key: 'DifficultyOffset', label: 'Difficulté (0 à 1)', type: 'number' },
    { key: 'OverrideOfficialDifficulty', label: 'Niveau max dinos sauvages ÷ 30 (5 = niveau 150)', type: 'number' },
    { key: 'XPMultiplier', label: 'Multiplicateur XP', type: 'number' },
    { key: 'TamingSpeedMultiplier', label: 'Multiplicateur vitesse de domestication', type: 'number' },
    { key: 'HarvestAmountMultiplier', label: 'Multiplicateur ressources récoltées', type: 'number' },
    { key: 'DayCycleSpeedScale', label: 'Vitesse du cycle jour/nuit', type: 'number' },
  ];

  const state = {
    rootFolder: null,
    servers: [],
    currentServer: null,
    knownMaps: [],
    lastServerSettingsEntries: [],
    cardDots: new Map(), // serverPath -> élément .status-dot de la carte dans la liste
    stopTimeoutId: null,
  };

  const el = {
    rootFolderLabel: document.getElementById('arkRootFolderLabel'),
    chooseFolderBtn: document.getElementById('arkChooseFolderBtn'),
    refreshBtn: document.getElementById('arkRefreshBtn'),
    serverList: document.getElementById('arkServerList'),
    emptyState: document.getElementById('arkEmptyState'),
    serverDetail: document.getElementById('arkServerDetail'),
    backBtn: document.getElementById('arkBackBtn'),
    detailName: document.getElementById('arkDetailName'),
    statusDot: document.getElementById('arkStatusDot'),
    errorBanner: document.getElementById('arkErrorBanner'),
    stopWarningBanner: document.getElementById('arkStopWarningBanner'),
    consoleOutput: document.getElementById('arkConsoleOutput'),
    commandInput: document.getElementById('arkCommandInput'),
    sendCommandBtn: document.getElementById('arkSendCommandBtn'),
    launchBtn: document.getElementById('arkLaunchBtn'),
    setupBtn: document.getElementById('arkSetupBtn'),
    stopBtn: document.getElementById('arkStopBtn'),
    forceStopBtn: document.getElementById('arkForceStopBtn'),
    generateScriptBtn: document.getElementById('arkGenerateScriptBtn'),
    launchInfo: document.getElementById('arkLaunchInfo'),

    mapSelect: document.getElementById('arkMapSelect'),
    customMapWrap: document.getElementById('arkCustomMapWrap'),
    customMapInput: document.getElementById('arkCustomMapInput'),
    sessionName: document.getElementById('arkSessionName'),
    serverPassword: document.getElementById('arkServerPassword'),
    adminPassword: document.getElementById('arkAdminPassword'),
    maxPlayers: document.getElementById('arkMaxPlayers'),
    port: document.getElementById('arkPort'),
    queryPort: document.getElementById('arkQueryPort'),
    extraSessionParams: document.getElementById('arkExtraSessionParams'),
    extraFlags: document.getElementById('arkExtraFlags'),
    saveLaunchConfigBtn: document.getElementById('arkSaveLaunchConfigBtn'),
    launchSaveStatus: document.getElementById('arkLaunchSaveStatus'),

    commonSettingsForm: document.getElementById('arkCommonSettingsForm'),
    saveCommonSettingsBtn: document.getElementById('arkSaveCommonSettingsBtn'),
    commonSaveStatus: document.getElementById('arkCommonSaveStatus'),

    advancedForm: document.getElementById('arkAdvancedForm'),
    newKeyInput: document.getElementById('arkNewKeyInput'),
    newValueInput: document.getElementById('arkNewValueInput'),
    addEntryBtn: document.getElementById('arkAddEntryBtn'),
    saveAdvancedBtn: document.getElementById('arkSaveAdvancedBtn'),
    advancedSaveStatus: document.getElementById('arkAdvancedSaveStatus'),
  };

  // Doit correspondre exactement à arkServerId() côté processus principal (main.js).
  function serverId(serverPath) {
    return `ark:${serverPath}`;
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
    el.setupBtn.disabled = running;
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

  window.api.onServerLog(({ serverId: id, lines }) => {
    if (state.currentServer && serverId(state.currentServer.path) === id) appendConsoleLines(lines);
  });

  window.api.onServerStatus(({ serverId: id, status, errorMessage }) => {
    for (const [path, dot] of state.cardDots) {
      if (serverId(path) === id) dot.className = `status-dot status-${status}`;
    }
    if (state.currentServer && serverId(state.currentServer.path) === id) applyStatus({ status, errorMessage });
  });

  function showStatus(elm, text) {
    elm.textContent = text;
    setTimeout(() => { if (elm.textContent === text) elm.textContent = ''; }, 3000);
  }

  const CUSTOM_MAP_VALUE = '__custom__';

  function populateMapSelect(selectEl, editionFilter) {
    selectEl.innerHTML = '';
    const maps = editionFilter ? state.knownMaps.filter((m) => m.edition === editionFilter) : state.knownMaps;

    for (const map of maps) {
      const opt = document.createElement('option');
      opt.value = map.id;
      opt.textContent = map.label;
      selectEl.appendChild(opt);
    }
    const customOpt = document.createElement('option');
    customOpt.value = CUSTOM_MAP_VALUE;
    customOpt.textContent = 'Autre (carte personnalisée / moddée)…';
    selectEl.appendChild(customOpt);
  }

  async function ensureMapOptions(editionFilter) {
    if (state.knownMaps.length === 0) {
      state.knownMaps = await window.api.arkGetKnownMaps();
    }
    populateMapSelect(el.mapSelect, editionFilter);
  }

  el.mapSelect.addEventListener('change', () => {
    el.customMapWrap.style.display = el.mapSelect.value === CUSTOM_MAP_VALUE ? 'flex' : 'none';
  });

  function populateLaunchConfigForm(config) {
    const isKnown = state.knownMaps.some((m) => m.id === config.map);
    el.mapSelect.value = isKnown ? config.map : CUSTOM_MAP_VALUE;
    el.customMapWrap.style.display = isKnown ? 'none' : 'flex';
    el.customMapInput.value = isKnown ? '' : config.map;

    el.sessionName.value = config.sessionName || '';
    el.serverPassword.value = config.serverPassword || '';
    el.adminPassword.value = config.adminPassword || '';
    el.maxPlayers.value = config.maxPlayers ?? 70;
    el.port.value = config.port ?? 7777;
    el.queryPort.value = config.queryPort ?? 27015;
    el.extraSessionParams.value = config.extraSessionParams || '';
    el.extraFlags.value = config.extraFlags || '';
  }

  function collectLaunchConfig() {
    return {
      map: el.mapSelect.value === CUSTOM_MAP_VALUE ? el.customMapInput.value.trim() : el.mapSelect.value,
      sessionName: el.sessionName.value.trim(),
      serverPassword: el.serverPassword.value,
      adminPassword: el.adminPassword.value,
      maxPlayers: Number(el.maxPlayers.value) || 70,
      port: Number(el.port.value) || 7777,
      queryPort: Number(el.queryPort.value) || 27015,
      extraSessionParams: el.extraSessionParams.value.trim(),
      extraFlags: el.extraFlags.value.trim(),
    };
  }

  function findEntryValue(entries, key) {
    const found = entries.find((e) => e.key === key);
    return found ? found.value : '';
  }

  function renderCommonSettingsForm(serverSettingsEntries) {
    el.commonSettingsForm.innerHTML = '';

    for (const def of COMMON_SETTINGS) {
      const currentValue = findEntryValue(serverSettingsEntries, def.key);
      const label = document.createElement('label');

      if (def.type === 'boolean') {
        label.className = 'checkbox-field';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = `arkCommon_${def.key}`;
        checkbox.checked = currentValue.toLowerCase() === 'true';
        label.appendChild(checkbox);
        const span = document.createElement('span');
        span.textContent = def.label;
        label.appendChild(span);
      } else {
        const span = document.createElement('span');
        span.textContent = def.label;
        label.appendChild(span);
        const input = document.createElement('input');
        input.type = 'text';
        input.id = `arkCommon_${def.key}`;
        input.value = currentValue;
        input.placeholder = '(non défini)';
        label.appendChild(input);
      }

      el.commonSettingsForm.appendChild(label);
    }
  }

  function collectCommonSettingsUpdates() {
    return COMMON_SETTINGS.filter((def) => {
      const field = document.getElementById(`arkCommon_${def.key}`);
      return field && (def.type === 'boolean' || field.value !== '');
    }).map((def) => {
      const field = document.getElementById(`arkCommon_${def.key}`);
      const value = def.type === 'boolean' ? (field.checked ? 'True' : 'False') : field.value;
      return { file: 'gameUserSettings', section: 'ServerSettings', key: def.key, value };
    });
  }

  function renderAdvancedForm(serverSettingsEntries) {
    state.lastServerSettingsEntries = serverSettingsEntries;
    el.advancedForm.innerHTML = '';

    serverSettingsEntries.forEach((entry, index) => {
      const label = document.createElement('label');
      const span = document.createElement('span');
      span.textContent = entry.key;
      const input = document.createElement('input');
      input.type = 'text';
      input.value = entry.value;
      input.dataset.key = entry.key;
      input.dataset.index = String(index);
      label.appendChild(span);
      label.appendChild(input);
      el.advancedForm.appendChild(label);
    });

    if (serverSettingsEntries.length === 0) {
      const hint = document.createElement('p');
      hint.className = 'hint-text';
      hint.textContent = 'Aucun paramètre trouvé dans [ServerSettings].';
      el.advancedForm.appendChild(hint);
    }
  }

  function collectAdvancedUpdates() {
    const updates = [];
    el.advancedForm.querySelectorAll('input[data-key]').forEach((input) => {
      updates.push({ file: 'gameUserSettings', section: 'ServerSettings', key: input.dataset.key, value: input.value });
    });
    return updates;
  }

  async function loadSettingsIntoForms(serverPath) {
    const settings = await window.api.arkReadSettings(serverPath);
    renderCommonSettingsForm(settings.gameUserSettings.serverSettings);
    renderAdvancedForm(settings.gameUserSettings.serverSettings);
  }

  async function openDetail(server) {
    state.currentServer = server;
    el.serverList.style.display = 'none';
    el.emptyState.style.display = 'none';
    el.serverDetail.style.display = 'block';
    el.detailName.textContent = server.name;
    resetConsole();
    clearStopWarning();

    el.launchInfo.textContent = server.executable
      ? `Exécutable détecté : ${server.executable.split(/[\\/]/).pop()} (${server.edition === 'ascended' ? 'Ascended' : server.edition === 'evolved' ? 'Evolved' : 'édition inconnue'})`
      : "Aucun exécutable serveur trouvé dans ShooterGame\\Binaries\\Win64.";
    el.generateScriptBtn.disabled = !server.executable;

    const current = await window.api.arkGetServerStatus(server.path);
    applyStatus(current);
    if (current.logLines && current.logLines.length > 0) appendConsoleLines(current.logLines);
    el.launchBtn.disabled = !server.executable || current.status === 'running' || current.status === 'starting';

    // On ne propose que les cartes de l'édition réellement installée sur le
    // disque (déduite de l'exécutable trouvé) : impossible de sélectionner
    // une carte Evolved pour un dossier qui contient le binaire Ascended, et
    // inversement — c'est justement ce mélange qui causait le lancement du
    // mauvais exécutable malgré la carte choisie.
    await ensureMapOptions(server.edition);

    const config = await window.api.arkReadLaunchConfig(server.path);
    populateLaunchConfigForm(config);

    await loadSettingsIntoForms(server.path);
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
      el.emptyState.textContent = 'Sélectionne le dossier contenant tes serveurs Ark pour commencer.';
      el.emptyState.style.display = 'flex';
      return;
    }

    if (state.servers.length === 0) {
      el.emptyState.textContent = 'Aucun serveur Ark détecté dans ce dossier (recherche d\'un sous-dossier "ShooterGame").';
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
        server.executable ? 'Exécutable trouvé' : 'Exécutable introuvable',
        server.hasConfig ? 'Configuration trouvée' : 'Configuration absente',
      ].join('<br>');

      card.appendChild(title);
      card.appendChild(meta);
      card.addEventListener('click', () => { window.GameSounds?.navigate(); openDetail(server); });

      el.serverList.appendChild(card);

      window.api.arkGetServerStatus(server.path).then(({ status }) => {
        dot.className = `status-dot status-${status}`;
      });
    }
  }

  async function refreshList() {
    if (!state.rootFolder) {
      el.emptyState.textContent = 'Recherche automatique de ton installation Ark en cours… (peut prendre quelques instants au premier lancement)';
      el.emptyState.style.display = 'flex';
    }

    const result = await window.api.arkListServers();
    state.rootFolder = result.rootFolder;
    state.servers = result.servers;

    el.rootFolderLabel.textContent = state.rootFolder || 'Aucun dossier sélectionné';
    renderServerList();
  }

  el.chooseFolderBtn.addEventListener('click', async () => {
    window.GameSounds?.toggle();
    const folder = await window.api.arkChooseRootFolder();
    if (folder) await refreshList();
  });

  el.refreshBtn.addEventListener('click', () => { window.GameSounds?.toggle(); refreshList(); });
  el.backBtn.addEventListener('click', () => { window.GameSounds?.back(); closeDetail(); });

  el.saveLaunchConfigBtn.addEventListener('click', async () => {
    if (!state.currentServer) return;
    const config = collectLaunchConfig();
    await window.api.arkWriteLaunchConfig(state.currentServer.path, config);
    window.GameSounds?.confirm();
    showStatus(el.launchSaveStatus, 'Enregistré ✓');
  });

  el.saveCommonSettingsBtn.addEventListener('click', async () => {
    if (!state.currentServer) return;
    const updates = collectCommonSettingsUpdates();
    const settings = await window.api.arkWriteSettings(state.currentServer.path, updates);
    renderCommonSettingsForm(settings.gameUserSettings.serverSettings);
    renderAdvancedForm(settings.gameUserSettings.serverSettings);
    window.GameSounds?.confirm();
    showStatus(el.commonSaveStatus, 'Enregistré ✓');
  });

  el.saveAdvancedBtn.addEventListener('click', async () => {
    if (!state.currentServer) return;
    const updates = collectAdvancedUpdates();
    const settings = await window.api.arkWriteSettings(state.currentServer.path, updates);
    renderCommonSettingsForm(settings.gameUserSettings.serverSettings);
    renderAdvancedForm(settings.gameUserSettings.serverSettings);
    window.GameSounds?.confirm();
    showStatus(el.advancedSaveStatus, 'Enregistré ✓');
  });

  el.addEntryBtn.addEventListener('click', async () => {
    if (!state.currentServer) return;
    const key = el.newKeyInput.value.trim();
    const value = el.newValueInput.value.trim();
    if (!key) return;

    const settings = await window.api.arkWriteSettings(state.currentServer.path, [
      { file: 'gameUserSettings', section: 'ServerSettings', key, value },
    ]);
    renderCommonSettingsForm(settings.gameUserSettings.serverSettings);
    renderAdvancedForm(settings.gameUserSettings.serverSettings);
    el.newKeyInput.value = '';
    el.newValueInput.value = '';
    window.GameSounds?.confirm();
  });

  el.setupBtn.addEventListener('click', async () => {
    if (!state.currentServer) return;
    window.GameSounds?.confirm();
    resetConsole();
    el.launchInfo.textContent = 'Application de la configuration…';

    // 1) Carte / session / ports
    const config = collectLaunchConfig();
    await window.api.arkWriteLaunchConfig(state.currentServer.path, config);

    // 2) Paramètres serveur courants (PvE, difficulté, multiplicateurs...)
    const updates = collectCommonSettingsUpdates();
    const settings = await window.api.arkWriteSettings(state.currentServer.path, updates);
    renderCommonSettingsForm(settings.gameUserSettings.serverSettings);
    renderAdvancedForm(settings.gameUserSettings.serverSettings);

    // 3) Lancement automatique
    const result = await window.api.arkLaunchServer(state.currentServer.path, config);
    if (!result.ok) {
      el.launchInfo.textContent = `Configuration appliquée, mais échec au lancement : ${result.error}`;
    } else {
      el.launchInfo.textContent = `Configuration appliquée et serveur lancé — carte : ${config.map}`;
    }
  });

  el.launchBtn.addEventListener('click', async () => {
    if (!state.currentServer) return;
    window.GameSounds?.confirm();
    resetConsole();

    const config = collectLaunchConfig();
    await window.api.arkWriteLaunchConfig(state.currentServer.path, config);

    const result = await window.api.arkLaunchServer(state.currentServer.path, config);
    if (!result.ok) {
      el.launchInfo.textContent = `Erreur au lancement : ${result.error}`;
    } else {
      el.launchInfo.textContent = `Lancement en cours — carte : ${config.map}`;
    }
    // Le statut définitif (running / error / crashed) arrive de façon asynchrone
    // via l'évènement onServerStatus, capté plus haut.
  });

  el.stopBtn.addEventListener('click', async () => {
    if (!state.currentServer) return;
    window.GameSounds?.back();
    clearStopWarning();
    await window.api.arkStopServer(state.currentServer.path);

    state.stopTimeoutId = setTimeout(() => {
      el.stopWarningBanner.textContent =
        "⏳ Le serveur ne s'est pas encore arrêté après 25 secondes. Tu peux utiliser « Forcer l'arrêt » ci-dessus si nécessaire — mais attention, les données non sauvegardées seront perdues.";
      el.stopWarningBanner.style.display = 'block';
    }, 25000);
  });

  el.forceStopBtn.addEventListener('click', async () => {
    if (!state.currentServer) return;
    const confirmed = confirm(
      "Forcer l'arrêt va tuer immédiatement le serveur, sans lui laisser le temps de sauvegarder. Continuer ?"
    );
    if (!confirmed) return;

    window.GameSounds?.back();
    await window.api.arkForceStopServer(state.currentServer.path);
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
    const result = await window.api.arkSendCommand(state.currentServer.path, command);
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

  el.generateScriptBtn.addEventListener('click', async () => {
    if (!state.currentServer) return;
    window.GameSounds?.toggle();

    const config = collectLaunchConfig();
    await window.api.arkWriteLaunchConfig(state.currentServer.path, config);

    const result = await window.api.arkGenerateScript(state.currentServer.path, config);
    el.launchInfo.textContent = result.ok
      ? `Script généré : ${result.scriptPath.split(/[\\/]/).pop()}`
      : `Erreur : ${result.error}`;
  });

  // ---------- Assistant de création de serveur ----------

  const createEl = {
    modal: document.getElementById('arkCreateServerModal'),
    form: document.getElementById('arkCreateForm'),
    progress: document.getElementById('arkCreateProgress'),
    progressLabel: document.getElementById('arkCreateProgressLabel'),
    folderProgress: document.getElementById('arkCreateFolderProgress'),
    consoleOutput: document.getElementById('arkCreateConsoleOutput'),
    errorBanner: document.getElementById('arkCreateErrorBanner'),
    closeBtn: document.getElementById('arkCreateCloseBtn'),

    folderName: document.getElementById('arkCreateFolderName'),
    edition: document.getElementById('arkCreateEdition'),
    mapSelect: document.getElementById('arkCreateMapSelect'),
    customMapWrap: document.getElementById('arkCreateCustomMapWrap'),
    customMapInput: document.getElementById('arkCreateCustomMapInput'),
    sessionName: document.getElementById('arkCreateSessionName'),
    serverPassword: document.getElementById('arkCreateServerPassword'),
    adminPassword: document.getElementById('arkCreateAdminPassword'),
    maxPlayers: document.getElementById('arkCreateMaxPlayers'),
    port: document.getElementById('arkCreatePort'),
    queryPort: document.getElementById('arkCreateQueryPort'),
    pve: document.getElementById('arkCreatePve'),
    difficulty: document.getElementById('arkCreateDifficulty'),
    maxDinoLevel: document.getElementById('arkCreateMaxDinoLevel'),
    xpMultiplier: document.getElementById('arkCreateXpMultiplier'),
    tamingMultiplier: document.getElementById('arkCreateTamingMultiplier'),
    harvestMultiplier: document.getElementById('arkCreateHarvestMultiplier'),

    createBtn: document.getElementById('arkCreateServerBtn'),
    cancelBtn: document.getElementById('arkCreateCancelBtn'),
    confirmBtn: document.getElementById('arkCreateConfirmBtn'),
  };

  createEl.mapSelect.addEventListener('change', () => {
    createEl.customMapWrap.style.display = createEl.mapSelect.value === CUSTOM_MAP_VALUE ? 'flex' : 'none';
  });

  // Dès que l'édition change, on ré-affiche uniquement les cartes de cette
  // édition : impossible de se retrouver avec une combinaison incohérente
  // (ex: Édition "Evolved" + carte "The Island (Ascended)"), qui ferait
  // installer un serveur mais en lui passant le nom de carte de l'autre jeu.
  createEl.edition.addEventListener('change', () => {
    populateMapSelect(createEl.mapSelect, createEl.edition.value);
    createEl.customMapWrap.style.display = 'none';
    createEl.customMapInput.value = '';
  });

  function appendCreateConsoleLines(lines) {
    if (!lines || lines.length === 0) return;
    for (const line of lines) {
      const div = document.createElement('div');
      div.textContent = line;
      createEl.consoleOutput.appendChild(div);
    }
    createEl.consoleOutput.scrollTop = createEl.consoleOutput.scrollHeight;
  }

  function formatBytesShort(bytes) {
    const gb = bytes / (1024 * 1024 * 1024);
    if (gb >= 0.1) return `${gb.toFixed(2)} Go`;
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(0)} Mo`;
  }

  /**
   * Sonde régulièrement la taille du dossier d'installation pendant que la
   * promesse fournie (l'appel principal de création) est encore en cours, pour
   * donner une preuve de progression concrète même si la console SteamCMD
   * reste silencieuse (ce qui est fréquent : elle bufferise sa sortie quand
   * elle n'est pas interactive). S'arrête automatiquement dès que l'opération
   * se termine, quel que soit le résultat.
   */
  async function pollInstallProgressDuring(mainPromise, parentFolder, folderName, edition) {
    let finished = false;
    mainPromise.finally(() => { finished = true; });

    (async function loop() {
      while (!finished) {
        try {
          const { fileCount, totalBytes } = await window.api.arkGetInstallProgress(parentFolder, folderName, edition);
          if (!finished) {
            createEl.folderProgress.textContent = fileCount > 0
              ? `📦 Progression détectée : ${fileCount.toLocaleString('fr-FR')} fichiers, ${formatBytesShort(totalBytes)} téléchargés jusqu'à présent.`
              : "📦 En attente des premiers fichiers (le téléchargement démarre)…";
          }
        } catch (e) {
          // best effort : une erreur ponctuelle de lecture ne doit pas interrompre le sondage
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
    })();

    return mainPromise;
  }

  // Abonnement dédié à l'assistant : ne filtre que les évènements de
  // l'installation SteamCMD en cours (id préfixé "ark-install:"), pour ne pas
  // interférer avec les consoles habituelles des serveurs déjà existants.
  window.api.onServerLog(({ serverId: id, lines }) => {
    if (id.startsWith('ark-install:')) appendCreateConsoleLines(lines);
  });

  async function openCreateModal() {
    if (!state.rootFolder) {
      alert('Choisis d\'abord un dossier racine pour tes serveurs Ark (bouton "Choisir le dossier").');
      return;
    }

    await ensureMapOptions(createEl.edition.value);
    populateMapSelect(createEl.mapSelect, createEl.edition.value);
    createEl.customMapWrap.style.display = 'none';
    createEl.customMapInput.value = '';

    createEl.folderName.value = '';
    createEl.form.style.display = 'block';
    createEl.progress.style.display = 'none';
    createEl.errorBanner.style.display = 'none';
    createEl.closeBtn.style.display = 'none';
    createEl.consoleOutput.innerHTML = '';
    createEl.folderProgress.textContent = '';

    createEl.modal.style.display = 'flex';
  }

  function closeCreateModal() {
    createEl.modal.style.display = 'none';
  }

  createEl.createBtn.addEventListener('click', () => { window.GameSounds?.toggle(); openCreateModal(); });
  createEl.cancelBtn.addEventListener('click', () => { window.GameSounds?.back(); closeCreateModal(); });
  createEl.closeBtn.addEventListener('click', () => { window.GameSounds?.back(); closeCreateModal(); refreshList(); });

  createEl.confirmBtn.addEventListener('click', async () => {
    const folderName = createEl.folderName.value.trim();
    if (!folderName) {
      alert('Indique un nom de dossier pour ce serveur.');
      return;
    }

    const map = createEl.mapSelect.value === CUSTOM_MAP_VALUE ? createEl.customMapInput.value.trim() : createEl.mapSelect.value;
    if (!map) {
      alert('Indique une carte.');
      return;
    }

    const options = {
      parentFolder: state.rootFolder,
      folderName,
      edition: createEl.edition.value,
      map,
      sessionName: createEl.sessionName.value.trim() || 'Mon Serveur Ark',
      serverPassword: createEl.serverPassword.value,
      adminPassword: createEl.adminPassword.value,
      maxPlayers: Number(createEl.maxPlayers.value) || 70,
      port: Number(createEl.port.value) || 7777,
      queryPort: Number(createEl.queryPort.value) || 27015,
      extraSessionParams: '',
      extraFlags: '-server -log',
      pve: createEl.pve.checked,
      difficulty: Number(createEl.difficulty.value) || 1,
      overrideOfficialDifficulty: (Number(createEl.maxDinoLevel.value) || 150) / 30,
      xpMultiplier: Number(createEl.xpMultiplier.value) || 1,
      tamingMultiplier: Number(createEl.tamingMultiplier.value) || 1,
      harvestMultiplier: Number(createEl.harvestMultiplier.value) || 1,
    };

    window.GameSounds?.confirm();
    createEl.form.style.display = 'none';
    createEl.progress.style.display = 'block';
    createEl.progressLabel.textContent = "Installation via SteamCMD en cours… (peut prendre plusieurs minutes selon ta connexion, ne ferme pas l'appli)";
    createEl.consoleOutput.innerHTML = '';
    createEl.errorBanner.style.display = 'none';

    const result = await pollInstallProgressDuring(
      window.api.arkCreateAndLaunchServer(options),
      state.rootFolder,
      folderName,
      createEl.edition.value
    );

    if (result.ok) {
      createEl.progressLabel.textContent = '✅ Serveur créé et lancé avec succès !';
      window.GameSounds?.confirm();
    } else {
      createEl.progressLabel.textContent = `❌ Échec à l'étape « ${result.step} »`;
      createEl.errorBanner.textContent = `⚠ ${result.error}`;
      createEl.errorBanner.style.display = 'block';
    }
    createEl.closeBtn.style.display = 'inline-block';
  });

  window.ArkPanel = {
    onShow() {
      if (state.rootFolder !== null || state.servers.length > 0) return;
      refreshList();
    },
  };
})();
