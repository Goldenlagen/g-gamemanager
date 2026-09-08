'use strict';

// Tableau de bord unifié des serveurs (Minecraft / Ark / SteamCMD) : statut,
// RAM/CPU du process (arbre complet), actions rapides et auto-démarrage.
(function () {
  const state = {
    loaded: false,
    servers: [],
    filter: 'all',
    cards: new Map(), // id -> { root, dot, statusText, ram, cpu, startBtn, stopBtn, forceBtn }
    pollTimer: null,
  };

  const el = {
    list: document.getElementById('dashList'),
    empty: document.getElementById('dashEmpty'),
    refreshBtn: document.getElementById('dashRefreshBtn'),
    updatedLabel: document.getElementById('dashUpdatedLabel'),
    filter: document.getElementById('dashFilter'),
  };

  function tr(key, params) {
    const v = window.AppSettings ? window.AppSettings.t(key, params) : null;
    return v != null ? v : key;
  }

  function formatBytes(bytes) {
    if (!bytes) return '0 ' + tr('units.mb');
    const gb = bytes / (1024 * 1024 * 1024);
    if (gb >= 1) return gb.toFixed(1) + ' ' + tr('units.gb');
    return (bytes / (1024 * 1024)).toFixed(0) + ' ' + tr('units.mb');
  }

  function statusLabel(status) {
    switch (status) {
      case 'running': return tr('dash.running');
      case 'starting': return tr('dash.starting');
      case 'error': return tr('dash.error');
      default: return tr('dash.stopped');
    }
  }

  function isRunning(status) {
    return status === 'running' || status === 'starting';
  }

  function typeLabel(type) {
    if (type === 'minecraft') return 'Minecraft';
    if (type === 'ark') return 'Ark';
    if (type === 'steamcmd') return 'SteamCMD';
    return type;
  }

  async function openServer(server) {
    if (server.type === 'minecraft') {
      document.querySelector('.app-tab[data-view="minecraft"]')?.click();
      document.querySelector('#view-minecraft .subtab[data-subtab="mcservers"]')?.click();
      await window.MinecraftPanel?.openByPath?.(server.path);
      return;
    }
    if (server.type === 'ark') {
      document.querySelector('.app-tab[data-view="ark"]')?.click();
      await window.ArkPanel?.openByPath?.(server.path);
      return;
    }
    document.querySelector('.app-tab[data-view="steamcmd"]')?.click();
  }

  function applyCardStatus(card, server) {
    card.dot.className = `status-dot status-${server.status}`;
    card.statusText.textContent = statusLabel(server.status);
    const running = isRunning(server.status);
    card.startBtn.disabled = running || !server.canStart;
    card.stopBtn.disabled = !running;
    card.forceBtn.disabled = !running;
    if (!running) {
      card.ram.textContent = '—';
      card.cpu.textContent = '—';
    }
  }

  function buildCard(server) {
    const root = document.createElement('div');
    root.className = 'dash-card';
    root.dataset.id = server.id;

    const head = document.createElement('div');
    head.className = 'dash-card-head';
    const dot = document.createElement('span');
    dot.className = `status-dot status-${server.status}`;
    const name = document.createElement('span');
    name.className = 'dash-card-name';
    name.textContent = server.name;
    name.title = server.name;
    const badge = document.createElement('span');
    badge.className = `dash-badge dash-badge-${server.type}`;
    badge.textContent = typeLabel(server.type);
    head.appendChild(dot);
    head.appendChild(name);
    head.appendChild(badge);

    const stats = document.createElement('div');
    stats.className = 'dash-card-stats';
    const statusText = document.createElement('span');
    statusText.className = 'dash-status-text';
    statusText.textContent = statusLabel(server.status);
    const ramWrap = document.createElement('span');
    ramWrap.className = 'dash-stat';
    ramWrap.textContent = tr('dash.ram') + ' ';
    const ram = document.createElement('b');
    ram.textContent = '—';
    ramWrap.appendChild(ram);
    const cpuWrap = document.createElement('span');
    cpuWrap.className = 'dash-stat';
    cpuWrap.textContent = tr('dash.cpu') + ' ';
    const cpu = document.createElement('b');
    cpu.textContent = '—';
    cpuWrap.appendChild(cpu);
    stats.appendChild(statusText);
    stats.appendChild(ramWrap);
    stats.appendChild(cpuWrap);

    const actions = document.createElement('div');
    actions.className = 'dash-card-actions';

    const startBtn = document.createElement('button');
    startBtn.className = 'primary-highlight';
    startBtn.textContent = tr('dash.start');
    startBtn.addEventListener('click', async () => {
      window.GameSounds?.confirm();
      startBtn.disabled = true;
      await window.api.dashboardStart(server);
    });

    const stopBtn = document.createElement('button');
    stopBtn.className = 'danger';
    stopBtn.textContent = tr('dash.stop');
    stopBtn.addEventListener('click', async () => {
      window.GameSounds?.back();
      stopBtn.disabled = true;
      await window.api.dashboardStop(server);
    });

    const forceBtn = document.createElement('button');
    forceBtn.className = 'danger';
    forceBtn.textContent = tr('dash.force');
    forceBtn.title = tr('dash.forceTitle');
    forceBtn.addEventListener('click', async () => {
      if (!confirm(tr('dash.forceConfirm', { name: server.name }))) return;
      window.GameSounds?.back();
      forceBtn.disabled = true;
      await window.api.dashboardForceStop(server);
    });

    const openBtn = document.createElement('button');
    openBtn.className = 'secondary';
    openBtn.textContent = tr('dash.open');
    openBtn.addEventListener('click', () => openServer(server));

    const autoLabel = document.createElement('label');
    autoLabel.className = 'dash-autostart';
    const autoCb = document.createElement('input');
    autoCb.type = 'checkbox';
    autoCb.checked = !!server.autoStart;
    autoCb.addEventListener('change', () => {
      window.api.dashboardSetAutostart(server.id, autoCb.checked);
      server.autoStart = autoCb.checked;
    });
    const autoText = document.createElement('span');
    autoText.textContent = tr('dash.autostart');
    autoLabel.appendChild(autoCb);
    autoLabel.appendChild(autoText);

    actions.appendChild(startBtn);
    actions.appendChild(stopBtn);
    actions.appendChild(forceBtn);
    actions.appendChild(openBtn);
    actions.appendChild(autoLabel);

    root.appendChild(head);
    root.appendChild(stats);
    root.appendChild(actions);

    // Automatisation (Minecraft / Ark uniquement) : redémarrage auto au crash
    // et redémarrage planifié toutes les N heures.
    if (server.type !== 'steamcmd') {
      const autoRow = document.createElement('div');
      autoRow.className = 'dash-card-auto';

      const arLabel = document.createElement('label');
      arLabel.className = 'dash-autostart';
      const arCb = document.createElement('input');
      arCb.type = 'checkbox';
      arCb.checked = !!server.autoRestart;
      arCb.addEventListener('change', () => {
        window.api.dashboardSetAutorestart(server.id, arCb.checked);
        server.autoRestart = arCb.checked;
      });
      const arText = document.createElement('span');
      arText.textContent = tr('dash.autorestart');
      arLabel.appendChild(arCb);
      arLabel.appendChild(arText);

      const rtWrap = document.createElement('label');
      rtWrap.className = 'dash-restart';
      const rtText = document.createElement('span');
      rtText.textContent = tr('dash.restartEvery');
      const rtInput = document.createElement('input');
      rtInput.type = 'number';
      rtInput.min = '0';
      rtInput.className = 'dash-restart-input';
      rtInput.value = server.restartHours || 0;
      rtInput.addEventListener('change', () => {
        const h = Number(rtInput.value) || 0;
        window.api.dashboardSetRestartInterval(server.id, h);
        server.restartHours = h;
      });
      const rtUnit = document.createElement('span');
      rtUnit.textContent = tr('dash.hoursUnit');
      rtWrap.appendChild(rtText);
      rtWrap.appendChild(rtInput);
      rtWrap.appendChild(rtUnit);

      autoRow.appendChild(arLabel);
      autoRow.appendChild(rtWrap);
      root.appendChild(autoRow);
    }

    const card = { root, dot, statusText, ram, cpu, startBtn, stopBtn, forceBtn };
    state.cards.set(server.id, card);
    applyCardStatus(card, server);
    return root;
  }

  function render() {
    el.list.innerHTML = '';
    state.cards.clear();

    const shown = state.servers.filter((s) => state.filter === 'all' || s.type === state.filter);

    if (shown.length === 0) {
      el.empty.style.display = 'block';
      return;
    }
    el.empty.style.display = 'none';
    for (const server of shown) el.list.appendChild(buildCard(server));
  }

  async function refresh() {
    state.servers = await window.api.dashboardList();
    render();
    refreshStats();
  }

  async function refreshStats() {
    const stats = await window.api.dashboardStats();
    for (const server of state.servers) {
      const card = state.cards.get(server.id);
      if (!card) continue;
      const s = stats[server.id];
      if (s && isRunning(server.status)) {
        card.ram.textContent = formatBytes(s.ramBytes);
        card.cpu.textContent = (typeof s.cpuPercent === 'number' ? s.cpuPercent : 0) + ' %';
      } else {
        card.ram.textContent = '—';
        card.cpu.textContent = '—';
      }
    }
    const loc = window.AppSettings && window.AppSettings.getLang() === 'en' ? 'en-GB' : 'fr-FR';
    el.updatedLabel.textContent = tr('dash.updated') + ' ' + new Date().toLocaleTimeString(loc);
  }

  function startPolling() {
    if (state.pollTimer) return;
    state.pollTimer = setInterval(refreshStats, 3000);
  }

  function stopPolling() {
    if (state.pollTimer) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
  }

  // Mise à jour du statut en direct (démarrages/arrêts déclenchés d'ici ou
  // depuis les onglets dédiés).
  window.api.onServerStatus(({ serverId, status }) => {
    const server = state.servers.find((s) => s.id === serverId);
    if (!server) return;
    server.status = status;
    const card = state.cards.get(serverId);
    if (card) applyCardStatus(card, server);
  });

  if (el.filter) {
    el.filter.querySelectorAll('.dash-filter-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        window.GameSounds?.toggle();
        state.filter = btn.dataset.filter || 'all';
        el.filter.querySelectorAll('.dash-filter-btn').forEach((b) => b.classList.toggle('active', b === btn));
        render();
        refreshStats();
      });
    });
  }

  el.refreshBtn.addEventListener('click', () => { window.GameSounds?.toggle(); refresh(); });

  // Retraduction à la volée si la langue change.
  document.addEventListener('gg-langchange', () => { if (state.loaded) refresh(); });

  window.DashboardPanel = {
    onShow() {
      state.loaded = true;
      refresh();
      startPolling();
    },
    onHide() {
      stopPolling();
    },
  };
})();
