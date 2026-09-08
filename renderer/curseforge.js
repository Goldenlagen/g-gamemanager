'use strict';

// Navigateur de modpacks CurseForge (ouvert depuis l'onglet Minecraft Profiles).
// Recherche paginée (10/page), filtre par type, choix de la version, puis :
//   - « Installer le modpack » : crée un profil dans le launcher Minecraft officiel
//     (mods + loader + icône). Grisé si la version est déjà installée.
//   - « Serverpack » : télécharge le serverpack dans le dossier racine des serveurs.
(function () {
  const state = {
    query: '',
    categoryIds: [], // plusieurs types sélectionnables (cases à cocher)
    index: 0,
    pageSize: 10,
    totalCount: 0,
    categoriesLoaded: false,
    loading: false,
    downloading: false,
    installedSet: new Set(), // "modId:fileId" déjà installés en profil
    installedServerpackKeys: new Set(), // "modId:serverPackFileId" déjà installés
    installedServerNames: new Set(), // noms normalisés des serveurs déjà présents
  };

  const el = {
    openBtn: document.getElementById('mcBrowseModpacksBtn'),
    modal: document.getElementById('cfModal'),
    closeBtn: document.getElementById('cfCloseBtn'),

    searchInput: document.getElementById('cfSearchInput'),
    categoryBtn: document.getElementById('cfCategoryBtn'),
    categoryPanel: document.getElementById('cfCategoryPanel'),
    searchBtn: document.getElementById('cfSearchBtn'),

    errorBanner: document.getElementById('cfErrorBanner'),

    downloadStatus: document.getElementById('cfDownloadStatus'),
    downloadLabel: document.getElementById('cfDownloadLabel'),
    downloadBar: document.getElementById('cfDownloadBar'),

    grid: document.getElementById('cfGrid'),
    empty: document.getElementById('cfEmpty'),
    loading: document.getElementById('cfLoading'),

    prevBtn: document.getElementById('cfPrevBtn'),
    nextBtn: document.getElementById('cfNextBtn'),
    pageInfo: document.getElementById('cfPageInfo'),
  };

  // Traduction (repli sur le texte français si la clé est absente).
  function t(key, fb, params) {
    const v = window.AppSettings ? window.AppSettings.t(key, params) : null;
    return v != null ? v : fb;
  }

  function showError(message) {
    if (!message) {
      el.errorBanner.style.display = 'none';
      el.errorBanner.textContent = '';
      return;
    }
    el.errorBanner.textContent = '⚠ ' + message;
    el.errorBanner.style.display = 'block';
  }

  function formatDownloads(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + ' M';
    if (n >= 1000) return (n / 1000).toFixed(1) + ' k';
    return String(n);
  }

  function formatBytes(bytes) {
    if (!bytes) return '0 ' + t('units.b', 'o');
    const units = [t('units.b', 'o'), t('units.kb', 'Ko'), t('units.mb', 'Mo'), t('units.gb', 'Go')];
    let i = 0;
    let n = bytes;
    while (n >= 1024 && i < units.length - 1) {
      n /= 1024;
      i++;
    }
    return n.toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
  }

  function installedKey(modId, fileId) {
    return modId + ':' + fileId;
  }

  // Doit rester identique à normalizeName() côté minecraftManager.js.
  function normalizeName(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  async function refreshInstalledSet() {
    try {
      const installed = await window.api.mcpGetInstalledModpacks();
      state.installedSet = new Set((installed || []).map((m) => installedKey(m.modId, m.fileId)));
    } catch (e) {
      state.installedSet = new Set();
    }
    try {
      const sp = await window.api.cfGetInstalledServerpacks();
      state.installedServerpackKeys = new Set((sp && sp.keys) || []);
      state.installedServerNames = new Set((sp && sp.names) || []);
    } catch (e) {
      state.installedServerpackKeys = new Set();
      state.installedServerNames = new Set();
    }
  }

  // ---------- Catégories ----------

  async function loadCategories() {
    const res = await window.api.cfGetCategories();
    if (!res || !res.ok) return;

    el.categoryPanel.innerHTML = '';
    for (const cat of res.categories) {
      const label = document.createElement('label');
      label.className = 'cf-cat-option';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = String(cat.id);
      cb.addEventListener('change', onCategoryToggle);
      const span = document.createElement('span');
      span.textContent = cat.name;
      label.appendChild(cb);
      label.appendChild(span);
      el.categoryPanel.appendChild(label);
    }
    state.categoriesLoaded = true;
  }

  function onCategoryToggle() {
    state.categoryIds = Array.from(
      el.categoryPanel.querySelectorAll('input[type="checkbox"]:checked')
    ).map((cb) => Number(cb.value));
    updateCategoryButtonLabel();
    doSearch(0);
  }

  function updateCategoryButtonLabel() {
    const n = state.categoryIds.length;
    el.categoryBtn.textContent = (n === 0 ? t('cf.allTypes', 'Tous les types') : `${t('cf.types', 'Types')} (${n})`) + ' ▾';
  }

  function toggleCategoryPanel(force) {
    const show = typeof force === 'boolean' ? force : el.categoryPanel.style.display === 'none';
    el.categoryPanel.style.display = show ? 'block' : 'none';
  }

  // ---------- Recherche ----------

  function setLoading(isLoading) {
    state.loading = isLoading;
    el.loading.style.display = isLoading ? 'block' : 'none';
    if (isLoading) el.empty.style.display = 'none';
  }

  async function doSearch(newIndex) {
    if (state.loading) return;

    state.query = el.searchInput.value.trim();
    state.index = Math.max(0, newIndex || 0);

    setLoading(true);
    showError('');
    el.grid.innerHTML = '';

    const res = await window.api.cfSearchModpacks({
      searchFilter: state.query,
      categoryIds: state.categoryIds,
      index: state.index,
    });

    setLoading(false);

    if (!res || !res.ok) {
      showError((res && res.error) || t('cf.searchFailed', 'Échec de la recherche.'));
      renderPagination();
      return;
    }

    state.totalCount = res.pagination.totalCount;
    renderGrid(res.modpacks);
    renderPagination();
  }

  function renderGrid(modpacks) {
    el.grid.innerHTML = '';
    if (!modpacks || modpacks.length === 0) {
      el.empty.style.display = 'block';
      return;
    }
    el.empty.style.display = 'none';
    for (const pack of modpacks) el.grid.appendChild(buildCard(pack));
  }

  function addThumbFallback(wrap, name) {
    const fb = document.createElement('div');
    fb.className = 'cf-thumb-fallback';
    fb.textContent = (name && name[0] ? name[0] : '?').toUpperCase();
    wrap.appendChild(fb);
  }

  function buildCard(pack) {
    const card = document.createElement('div');
    card.className = 'cf-card';

    // Vignette
    const thumbWrap = document.createElement('div');
    thumbWrap.className = 'cf-card-thumb';
    if (pack.thumbnailUrl) {
      const img = document.createElement('img');
      img.alt = '';
      img.src = pack.thumbnailUrl;
      img.addEventListener('error', () => { img.remove(); addThumbFallback(thumbWrap, pack.name); }, { once: true });
      thumbWrap.appendChild(img);
    } else {
      addThumbFallback(thumbWrap, pack.name);
    }

    // Titre + méta
    const title = document.createElement('div');
    title.className = 'cf-card-name';
    title.title = pack.name;
    title.textContent = pack.name;

    const meta = document.createElement('div');
    meta.className = 'cf-card-meta';
    meta.textContent = '⬇ ' + formatDownloads(pack.downloadCount);

    // Sélecteur de version
    const versionSelect = document.createElement('select');
    versionSelect.className = 'cf-version-select';
    versionSelect.innerHTML = '<option>' + t('cf.versionsLoading', 'Chargement des versions…') + '</option>';
    versionSelect.disabled = true;

    // Boutons
    const actions = document.createElement('div');
    actions.className = 'cf-card-actions';

    const installBtn = document.createElement('button');
    installBtn.className = 'cf-dl-btn';
    installBtn.textContent = t('cf.install', '⬇ Installer le modpack');
    installBtn.disabled = true;

    const serverBtn = document.createElement('button');
    serverBtn.className = 'cf-dl-btn secondary';
    serverBtn.textContent = t('cf.serverpack', 'Serverpack');
    serverBtn.disabled = true;

    actions.appendChild(installBtn);
    actions.appendChild(serverBtn);

    card.appendChild(thumbWrap);
    card.appendChild(title);
    card.appendChild(meta);
    card.appendChild(versionSelect);
    card.appendChild(actions);

    // Applique l'état des boutons selon la version sélectionnée.
    function applyVersionState() {
      const opt = versionSelect.selectedOptions[0];
      if (!opt) return;
      const fileId = Number(opt.value);
      const serverPackFileId = opt.dataset.serverpack ? Number(opt.dataset.serverpack) : null;
      const already = state.installedSet.has(installedKey(pack.id, fileId));

      installBtn.disabled = state.downloading || already;
      installBtn.textContent = already ? t('cf.installed', '✓ Déjà installé') : t('cf.install', '⬇ Installer le modpack');

      if (serverPackFileId) {
        const spInstalled =
          state.installedServerpackKeys.has(pack.id + ':' + serverPackFileId) ||
          state.installedServerNames.has(normalizeName(pack.name));
        if (spInstalled) {
          serverBtn.disabled = true;
          serverBtn.textContent = t('cf.serverInstalled', '✓ Serveur installé');
          serverBtn.title = t('cf.serverInstalledTitle', 'Un serveur pour ce modpack est déjà installé dans ton dossier.');
          serverBtn.dataset.serverpack = String(serverPackFileId);
        } else {
          serverBtn.disabled = state.downloading;
          serverBtn.textContent = t('cf.serverpack', 'Serverpack');
          serverBtn.title = '';
          serverBtn.dataset.serverpack = String(serverPackFileId);
        }
      } else {
        serverBtn.disabled = true;
        serverBtn.textContent = t('cf.noServerpack', 'Pas de serverpack');
        serverBtn.title = t('cf.noServerpackTitle', 'Cette version ne fournit pas de serverpack.');
        serverBtn.dataset.serverpack = '';
      }
    }

    versionSelect.addEventListener('change', applyVersionState);

    installBtn.addEventListener('click', () => {
      const opt = versionSelect.selectedOptions[0];
      if (!opt) return;
      startInstall(pack, Number(opt.value), card, () => applyVersionState(), installBtn);
    });

    serverBtn.addEventListener('click', () => {
      const spId = serverBtn.dataset.serverpack ? Number(serverBtn.dataset.serverpack) : null;
      if (!spId) return;
      startServerpack(pack, spId, serverBtn);
    });

    // Chargement asynchrone des versions.
    loadVersions(pack, versionSelect, applyVersionState);

    return card;
  }

  async function loadVersions(pack, versionSelect, applyVersionState) {
    const res = await window.api.cfGetModpackFiles(pack.id);
    if (!res || !res.ok || !res.files || res.files.length === 0) {
      versionSelect.innerHTML = '<option>' + t('cf.versionsUnavailable', 'Versions indisponibles') + '</option>';
      versionSelect.disabled = true;
      return;
    }

    versionSelect.innerHTML = '';
    for (const f of res.files) {
      const opt = document.createElement('option');
      opt.value = String(f.id);
      opt.dataset.serverpack = f.serverPackFileId ? String(f.serverPackFileId) : '';
      const bits = [];
      if (f.mcVersion) bits.push(f.mcVersion);
      if (f.loaderName) bits.push(f.loaderName);
      const already = state.installedSet.has(installedKey(pack.id, f.id));
      const suffix = (bits.length ? ' [' + bits.join(' ') + ']' : '') + (already ? t('cf.installedSuffix', ' ✓ installé') : '');
      let label = (f.displayName || f.fileName || String(f.id));
      if (label.length > 42) label = label.slice(0, 41) + '…';
      opt.textContent = label + suffix;
      versionSelect.appendChild(opt);
    }
    versionSelect.disabled = false;

    // Sélection par défaut : le fichier principal si présent.
    if (pack.mainFileId) {
      const match = Array.from(versionSelect.options).find((o) => Number(o.value) === pack.mainFileId);
      if (match) match.selected = true;
    }
    applyVersionState();
  }

  // ---------- Pagination ----------

  function renderPagination() {
    const start = state.index;
    const pageNumber = Math.floor(start / state.pageSize) + 1;
    const totalPages = Math.max(1, Math.ceil(state.totalCount / state.pageSize));

    el.pageInfo.textContent = state.totalCount
      ? `${t('cf.pageWord', 'Page')} ${pageNumber} / ${totalPages} (${state.totalCount} ${t('cf.modpacksWord', 'modpacks')})`
      : '';

    const nextIndex = start + state.pageSize;
    el.prevBtn.disabled = state.loading || state.downloading || start <= 0;
    el.nextBtn.disabled = state.loading || state.downloading || nextIndex >= state.totalCount || nextIndex >= 10000;
  }

  el.prevBtn.addEventListener('click', () => { if (state.index > 0) { doSearch(state.index - state.pageSize); } });
  el.nextBtn.addEventListener('click', () => { doSearch(state.index + state.pageSize); });
  el.searchBtn.addEventListener('click', () => { window.GameSounds?.toggle(); doSearch(0); });
  el.searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(0); });

  el.categoryBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleCategoryPanel();
  });
  // Le panneau reste ouvert quand on coche des cases ; il se ferme au clic ailleurs.
  el.categoryPanel.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', () => toggleCategoryPanel(false));

  // ---------- Téléchargements / installation ----------

  function setDownloading(isDownloading) {
    state.downloading = isDownloading;
    // Réévalue l'état des cartes (chaque select réapplique ses boutons).
    el.grid.querySelectorAll('.cf-version-select').forEach((sel) => {
      sel.dispatchEvent(new Event('change'));
    });
    el.searchBtn.disabled = isDownloading;
    // On empêche la fermeture tant qu'un téléchargement/installation est en cours.
    el.closeBtn.disabled = isDownloading;
    renderPagination();
  }

  function beginProgress(labelText) {
    el.downloadStatus.style.display = 'block';
    el.downloadBar.style.width = '0%';
    el.downloadBar.classList.remove('cf-bar-done'); // repart en couleur normale
    el.downloadLabel.textContent = labelText;
  }

  function markProgressDone() {
    el.downloadBar.style.width = '100%';
    el.downloadBar.classList.add('cf-bar-done'); // barre verte une fois terminé
  }

  function showBtnDownloading(btn) {
    if (btn) btn.innerHTML = '<span class="cf-dl-icon">⬇</span>';
  }

  async function startInstall(pack, fileId, card, reapply, btn) {
    if (state.downloading) return;
    showError('');
    setDownloading(true);
    showBtnDownloading(btn); // remplace le texte par une icône de téléchargement
    card.classList.add('cf-card-downloading');
    beginProgress(t('cf.prepInstall', `Préparation de l'installation : ${pack.name}…`, { name: pack.name }));
    window.GameSounds?.confirm();

    const res = await window.api.cfInstallProfile({
      modId: pack.id,
      fileId,
      name: pack.name,
      thumbnailUrl: pack.thumbnailUrl,
    });

    card.classList.remove('cf-card-downloading');

    if (!res || !res.ok) {
      el.downloadStatus.style.display = 'none';
      setDownloading(false);
      let msg = (res && res.error) || t('cf.installFailed', "Échec de l'installation.");
      if (res && res.needsJava) msg += t('cf.javaRequired', ' (Java requis pour Forge/NeoForge.)');
      if (res && res.alreadyInstalled) {
        await refreshInstalledSet();
        reapply && reapply();
      }
      showError(msg);
      return;
    }

    markProgressDone();
    let doneMsg = t('cf.profileCreated',
      `✓ Profil « ${pack.name} » créé dans le launcher Minecraft (MC ${res.mcVersion}, ${res.loader}).`,
      { name: pack.name, mc: res.mcVersion, loader: res.loader });
    if (res.failedMods && res.failedMods.length > 0) {
      doneMsg += t('cf.modsFailed',
        ` ⚠ ${res.failedMods.length}/${res.totalMods} mod(s) non téléchargé(s) (distribution désactivée par l'auteur — à ajouter manuellement).`,
        { failed: res.failedMods.length, total: res.totalMods });
    }
    el.downloadLabel.textContent = doneMsg;

    await refreshInstalledSet();
    reapply && reapply();
    setDownloading(false);
    window.McProfilesPanel?.refresh?.();
  }

  async function startServerpack(pack, serverPackFileId, btn) {
    if (state.downloading) return;
    showError('');
    setDownloading(true);
    showBtnDownloading(btn); // remplace le texte par une icône de téléchargement
    beginProgress(t('cf.dlServerpack', `Téléchargement du serverpack : ${pack.name}…`, { name: pack.name }));
    window.GameSounds?.confirm();

    const res = await window.api.cfDownloadServerpack({
      modId: pack.id,
      serverPackFileId,
      name: pack.name,
    });

    if (!res || !res.ok) {
      el.downloadStatus.style.display = 'none';
      setDownloading(false);
      showError((res && res.error) || t('cf.serverpackFailed', 'Échec du téléchargement du serverpack.'));
      return;
    }
    markProgressDone();
    el.downloadLabel.textContent = t('cf.serverpackDone', `✓ Serverpack « ${pack.name} » téléchargé dans ton dossier de serveurs.`, { name: pack.name });

    // Rafraîchit les serveurs installés pour griser immédiatement ce serverpack.
    await refreshInstalledSet();
    setDownloading(false);
    window.MinecraftPanel?.refresh?.();
  }

  // Progression en direct.
  window.api.onCfDownloadProgress((data) => {
    if (!data) return;
    switch (data.phase) {
      case 'resolving':
        el.downloadLabel.textContent = t('cf.phaseResolving', 'Résolution du lien de téléchargement…');
        el.downloadBar.style.width = '0%';
        break;
      case 'downloading':
        if (data.total > 0) {
          const pct = Math.min(100, Math.round((data.received / data.total) * 100));
          el.downloadBar.style.width = pct + '%';
          el.downloadLabel.textContent = t('cf.phaseDownloading',
            `Téléchargement… ${pct}% (${formatBytes(data.received)} / ${formatBytes(data.total)})`,
            { pct, received: formatBytes(data.received), total: formatBytes(data.total) });
        } else {
          el.downloadLabel.textContent = t('cf.phaseDownloadingSimple',
            `Téléchargement… ${formatBytes(data.received)}`, { received: formatBytes(data.received) });
        }
        break;
      case 'extracting':
        el.downloadBar.style.width = '100%';
        el.downloadLabel.textContent = t('cf.phaseExtracting', "Extraction de l'archive…");
        break;
      case 'overrides':
        el.downloadLabel.textContent = t('cf.phaseOverrides', 'Copie des fichiers de configuration (overrides)…');
        break;
      case 'mods': {
        const pct = data.total > 0 ? Math.round((data.received / data.total) * 100) : 0;
        el.downloadBar.style.width = pct + '%';
        el.downloadLabel.textContent = t('cf.phaseMods',
          `Téléchargement des mods… ${data.received}/${data.total}`,
          { received: data.received, total: data.total });
        break;
      }
      case 'loader':
        el.downloadBar.style.width = '100%';
        el.downloadLabel.textContent = t('cf.phaseLoader',
          `Installation du loader (${data.loader || '...'})…`, { loader: data.loader || '...' });
        break;
      case 'icon':
        el.downloadLabel.textContent = t('cf.phaseIcon', "Préparation de l'icône du profil…");
        break;
      case 'profile':
        el.downloadLabel.textContent = t('cf.phaseProfile', 'Création du profil dans le launcher…');
        break;
      default:
        break;
    }
  });

  // ---------- Ouverture / fermeture ----------

  async function openModal() {
    el.modal.style.display = 'flex';
    el.downloadStatus.style.display = 'none';
    updateCategoryButtonLabel();
    showError('');
    await refreshInstalledSet();
    if (!state.categoriesLoaded) await loadCategories();
    doSearch(0);
  }

  function closeModal() {
    if (state.downloading) return;
    el.modal.style.display = 'none';
  }

  el.openBtn.addEventListener('click', () => { window.GameSounds?.toggle(); openModal(); });
  el.closeBtn.addEventListener('click', () => { window.GameSounds?.back(); closeModal(); });
  el.modal.addEventListener('click', (e) => { if (e.target === el.modal) closeModal(); });

  // Retraduit les libellés dynamiques quand la langue change.
  document.addEventListener('gg-langchange', () => {
    updateCategoryButtonLabel();
    renderPagination();
    el.grid.querySelectorAll('.cf-version-select').forEach((sel) => sel.dispatchEvent(new Event('change')));
  });
})();
