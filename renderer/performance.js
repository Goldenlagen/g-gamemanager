'use strict';

(function () {
  const POLL_INTERVAL_MS = 2000;

  function T(key, fb) {
    const v = window.AppSettings ? window.AppSettings.t(key) : null;
    return v != null ? v : fb;
  }

  const state = {
    pollTimer: null,
  };

  const el = {
    updatedLabel: document.getElementById('perfUpdatedLabel'),
    cpuPercent: document.getElementById('perfCpuPercent'),
    cpuBar: document.getElementById('perfCpuBar'),
    cpuModel: document.getElementById('perfCpuModel'),
    cpuCores: document.getElementById('perfCpuCores'),
    ramPercent: document.getElementById('perfRamPercent'),
    ramBar: document.getElementById('perfRamBar'),
    ramDetail: document.getElementById('perfRamDetail'),
    gpuPercent: document.getElementById('perfGpuPercent'),
    gpuBar: document.getElementById('perfGpuBar'),
    gpuList: document.getElementById('perfGpuList'),
    gpuEmpty: document.getElementById('perfGpuEmpty'),
    disksList: document.getElementById('perfDisksList'),
    disksEmpty: document.getElementById('perfDisksEmpty'),
    procList: document.getElementById('perfProcList'),
    procEmpty: document.getElementById('perfProcEmpty'),
  };

  function formatBytes(bytes) {
    const gb = bytes / (1024 * 1024 * 1024);
    if (gb >= 1) return `${gb.toFixed(1)} ${T('units.gb', 'Go')}`;
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(0)} ${T('units.mb', 'Mo')}`;
  }

  function severityClass(percent) {
    if (percent >= 90) return 'perf-critical';
    if (percent >= 70) return 'perf-warning';
    return '';
  }

  function applyBar(barEl, percent) {
    barEl.style.width = `${Math.min(100, Math.max(0, percent))}%`;
    barEl.className = `perf-bar-fill ${severityClass(percent)}`.trim();
  }

  function renderCpu(cpu) {
    el.cpuPercent.textContent = `${cpu.overallPercent}%`;
    applyBar(el.cpuBar, cpu.overallPercent);
    el.cpuModel.textContent = `${cpu.model} — ${cpu.perCorePercent.length} ${T('perf.cores', 'cœurs (logiques)')}`;

    el.cpuCores.innerHTML = '';
    for (const corePercent of cpu.perCorePercent) {
      const bar = document.createElement('div');
      bar.className = 'perf-core-bar';
      bar.title = `${corePercent}%`;

      const fill = document.createElement('div');
      fill.className = `perf-core-bar-fill ${severityClass(corePercent)}`.trim();
      fill.style.height = `${Math.min(100, Math.max(0, corePercent))}%`;
      if (severityClass(corePercent) === '') fill.style.background = '#4cc2ff';

      bar.appendChild(fill);
      el.cpuCores.appendChild(bar);
    }
  }

  function renderMemory(memory) {
    el.ramPercent.textContent = `${memory.usedPercent}%`;
    applyBar(el.ramBar, memory.usedPercent);
    el.ramDetail.textContent = `${formatBytes(memory.usedBytes)} ${T('perf.ramUsed', 'utilisés sur')} ${formatBytes(memory.totalBytes)}`;
  }

  function renderGpu(gpu) {
    const gpus = gpu?.gpus || [];

    if (gpus.length === 0) {
      el.gpuPercent.textContent = '—';
      applyBar(el.gpuBar, 0);
      el.gpuList.textContent = '';
      el.gpuEmpty.style.display = 'block';
      return;
    }
    el.gpuEmpty.style.display = 'none';

    if (typeof gpu.usagePercent === 'number') {
      el.gpuPercent.textContent = `${gpu.usagePercent}%`;
      applyBar(el.gpuBar, gpu.usagePercent);
    } else {
      // Le compteur d'utilisation 3D n'est pas disponible sur toutes les
      // configurations (pilote, permissions...) : on affiche quand même le
      // matériel détecté plutôt que de tout masquer.
      el.gpuPercent.textContent = T('common.na', 'N/D');
      applyBar(el.gpuBar, 0);
    }

    el.gpuList.innerHTML = gpus
      .map((g) => `${g.name}${g.vramBytes ? ` — ${formatBytes(g.vramBytes)} VRAM` : ''}`)
      .join('<br>');
  }

  function renderDisks(disks) {
    el.disksList.innerHTML = '';

    if (!disks || disks.length === 0) {
      el.disksEmpty.style.display = 'block';
      return;
    }
    el.disksEmpty.style.display = 'none';

    for (const disk of disks) {
      const row = document.createElement('div');
      row.className = 'perf-disk-row';

      const label = document.createElement('div');
      label.className = 'perf-disk-label';
      const driveLabel = disk.name ? `${disk.drive} ${disk.name}` : disk.drive;
      const left = document.createElement('span');
      left.textContent = driveLabel;
      const right = document.createElement('span');
      right.textContent = `${formatBytes(disk.usedBytes)} / ${formatBytes(disk.totalBytes)} (${disk.usedPercent}%)`;
      label.appendChild(left);
      label.appendChild(right);

      const track = document.createElement('div');
      track.className = 'perf-bar-track';
      const fill = document.createElement('div');
      applyBar(fill, disk.usedPercent);
      track.appendChild(fill);

      row.appendChild(label);
      row.appendChild(track);
      el.disksList.appendChild(row);
    }
  }

  function renderProcesses(processes) {
    if (!el.procList) return;
    el.procList.innerHTML = '';

    const list = processes || [];
    if (list.length === 0) {
      if (el.procEmpty) el.procEmpty.style.display = 'block';
      return;
    }
    if (el.procEmpty) el.procEmpty.style.display = 'none';

    for (const proc of list) {
      const row = document.createElement('div');
      row.className = 'perf-proc-row';

      const name = document.createElement('span');
      name.className = 'perf-proc-name';
      name.textContent = proc.name;
      name.title = proc.name;

      const stats = document.createElement('span');
      stats.className = 'perf-proc-stats';
      stats.textContent = `${proc.cpuPercent}% CPU · ${formatBytes(proc.memBytes)}`;

      row.appendChild(name);
      row.appendChild(stats);
      el.procList.appendChild(row);
    }
  }

  async function refreshSnapshot() {
    const snapshot = await window.api.perfGetSnapshot();
    renderCpu(snapshot.cpu);
    renderMemory(snapshot.memory);
    renderGpu(snapshot.gpu);
    renderProcesses(snapshot.processes);
    renderDisks(snapshot.disks);

    const now = new Date(snapshot.timestamp);
    const loc = window.AppSettings && window.AppSettings.getLang() === 'en' ? 'en-GB' : 'fr-FR';
    el.updatedLabel.textContent = `${T('perf.updated', 'Mis à jour à')} ${now.toLocaleTimeString(loc)}`;
  }

  function startPolling() {
    if (state.pollTimer) return;
    refreshSnapshot(); // immédiat, sans attendre le premier intervalle
    state.pollTimer = setInterval(refreshSnapshot, POLL_INTERVAL_MS);
  }

  function stopPolling() {
    if (state.pollTimer) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
  }

  // Rafraîchit immédiatement (libellés + unités traduits) si l'onglet est visible.
  document.addEventListener('gg-langchange', () => { if (state.pollTimer) refreshSnapshot(); });

  window.PerformancePanel = {
    onShow() { startPolling(); },
    onHide() { stopPolling(); },
  };
})();
