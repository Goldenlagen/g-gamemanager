'use strict';

(function () {
  const state = {
    initialized: false,
  };

  const el = {
    statusDot: document.getElementById('steamcmdStatusDot'),
    notInstalled: document.getElementById('steamcmdNotInstalled'),
    installed: document.getElementById('steamcmdInstalled'),
    downloadBtn: document.getElementById('steamcmdDownloadBtn'),
    downloadStatus: document.getElementById('steamcmdDownloadStatus'),
    launchBtn: document.getElementById('steamcmdLaunchBtn'),
    stopBtn: document.getElementById('steamcmdStopBtn'),
    forceStopBtn: document.getElementById('steamcmdForceStopBtn'),
    resetBtn: document.getElementById('steamcmdResetBtn'),
    errorBanner: document.getElementById('steamcmdErrorBanner'),
    consoleOutput: document.getElementById('steamcmdConsoleOutput'),
    commandInput: document.getElementById('steamcmdCommandInput'),
    sendCommandBtn: document.getElementById('steamcmdSendCommandBtn'),
  };

  // Doit correspondre à PROCESS_ID côté processManager/steamcmdManager (main.js).
  const SERVER_ID = 'steamcmd';

  function applyStatus({ status, errorMessage }) {
    el.statusDot.className = `status-dot status-${status}`;

    const running = status === 'running' || status === 'starting';
    el.launchBtn.disabled = running;
    el.stopBtn.disabled = !running;
    el.forceStopBtn.disabled = !running;

    const canSendCommand = status === 'running';
    el.commandInput.disabled = !canSendCommand;
    el.sendCommandBtn.disabled = !canSendCommand;

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
    el.consoleOutput.innerHTML = '<div class="console-empty">Aucune sortie pour le moment. Lance SteamCMD pour voir la console ici.</div>';
  }

  window.api.onServerLog(({ serverId: id, lines }) => {
    if (id === SERVER_ID) appendConsoleLines(lines);
  });

  window.api.onServerStatus(({ serverId: id, status, errorMessage }) => {
    if (id === SERVER_ID) applyStatus({ status, errorMessage });
  });

  async function refreshInstalledState() {
    const isInstalled = await window.api.steamcmdIsInstalled();
    el.notInstalled.style.display = isInstalled ? 'none' : 'block';
    el.installed.style.display = isInstalled ? 'block' : 'none';

    if (isInstalled) {
      const current = await window.api.steamcmdGetStatus();
      applyStatus(current);
      if (current.logLines && current.logLines.length > 0) {
        resetConsole();
        appendConsoleLines(current.logLines);
      } else {
        resetConsole();
      }
    }
  }

  el.downloadBtn.addEventListener('click', async () => {
    window.GameSounds?.toggle();
    el.downloadBtn.disabled = true;
    el.downloadStatus.textContent = 'Téléchargement et extraction en cours (quelques instants)…';

    const result = await window.api.steamcmdDownload();

    if (result.ok) {
      el.downloadStatus.textContent = '';
      window.GameSounds?.confirm();
      await refreshInstalledState();
    } else {
      el.downloadBtn.disabled = false;
      el.downloadStatus.textContent = `⚠ ${result.error}`;
    }
  });

  el.resetBtn.addEventListener('click', async () => {
    const confirmed = confirm(
      "Ça va supprimer entièrement SteamCMD (il faudra le retélécharger). Utile en cas d'erreur " +
      "\"didn't shutdown cleanly\" ou \"missing configuration\" lors d'une installation. Continuer ?"
    );
    if (!confirmed) return;

    window.GameSounds?.back();
    el.resetBtn.disabled = true;
    const result = await window.api.steamcmdReset();
    el.resetBtn.disabled = false;

    if (result.ok) {
      window.GameSounds?.confirm();
      await refreshInstalledState();
    } else {
      alert(`Échec de la réinitialisation : ${result.error}`);
    }
  });

  el.launchBtn.addEventListener('click', async () => {
    window.GameSounds?.confirm();
    resetConsole();
    const result = await window.api.steamcmdLaunch();
    if (!result.ok) {
      el.errorBanner.textContent = `⚠ ${result.error}`;
      el.errorBanner.style.display = 'block';
    }
  });

  el.stopBtn.addEventListener('click', async () => {
    window.GameSounds?.back();
    await window.api.steamcmdStop();
  });

  el.forceStopBtn.addEventListener('click', async () => {
    const confirmed = confirm("Forcer l'arrêt va tuer immédiatement SteamCMD. Continuer ?");
    if (!confirmed) return;
    window.GameSounds?.back();
    await window.api.steamcmdForceStop();
  });

  async function sendCommand() {
    const command = el.commandInput.value.trim();
    if (!command) return;

    const line = document.createElement('div');
    line.className = 'console-line-command';
    line.textContent = `> ${command}`;
    el.consoleOutput.querySelector('.console-empty')?.remove();
    el.consoleOutput.appendChild(line);
    el.consoleOutput.scrollTop = el.consoleOutput.scrollHeight;

    el.commandInput.value = '';
    const result = await window.api.steamcmdSendCommand(command);
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

  // Boutons de raccourcis : remplissent simplement le champ de commande,
  // sans l'envoyer automatiquement — à l'utilisateur de valider.
  document.querySelectorAll('.quick-cmd').forEach((btn) => {
    btn.addEventListener('click', () => {
      window.GameSounds?.toggle();
      el.commandInput.value = btn.dataset.cmd;
      el.commandInput.focus();
    });
  });

  window.SteamCmdPanel = {
    onShow() {
      if (state.initialized) return;
      state.initialized = true;
      resetConsole();
      refreshInstalledState();
    },
  };
})();
