'use strict';

// Onglet « Profiles Minecraft » : liste les profils du launcher Minecraft
// officiel (launcher_profiles.json), avec filtre par type (Modpack/Vanilla/Autre).
(function () {
  const state = { loaded: false, filter: 'all', profiles: [] };

  const el = {
    dirLabel: document.getElementById('mcpDirLabel'),
    warning: document.getElementById('mcpWarning'),
    list: document.getElementById('mcpProfilesList'),
    empty: document.getElementById('mcpEmpty'),
    refreshBtn: document.getElementById('mcpRefreshBtn'),
    filter: document.getElementById('mcpFilter'),
  };

  function t(key, fallback, params) {
    const v = window.AppSettings ? window.AppSettings.t(key, params) : null;
    return v != null ? v : fallback;
  }

  function isDataUri(icon) {
    return typeof icon === 'string' && icon.startsWith('data:');
  }

  function showWarning(text) {
    el.warning.textContent = '⚠ ' + text;
    el.warning.style.display = 'block';
  }

  function kindOf(profile) {
    return profile.kind || (profile.isModpack ? 'modpack' : 'other');
  }

  function buildCard(profile) {
    const card = document.createElement('div');
    card.className = 'cf-profile-card';

    const iconWrap = document.createElement('div');
    iconWrap.className = 'cf-profile-icon';
    if (isDataUri(profile.icon)) {
      const img = document.createElement('img');
      img.alt = '';
      img.src = profile.icon;
      img.addEventListener('error', () => { img.remove(); addIconFallback(iconWrap, profile.name); }, { once: true });
      iconWrap.appendChild(img);
    } else if (profile.isModpack && profile.modpack && profile.modpack.modId) {
      addIconFallback(iconWrap, profile.name);
      window.api
        .cfGetModLogo(profile.modpack.modId)
        .then((res) => {
          if (res && res.ok && res.thumbnailUrl) {
            const img = document.createElement('img');
            img.alt = '';
            img.addEventListener('load', () => {
              iconWrap.innerHTML = '';
              iconWrap.appendChild(img);
            }, { once: true });
            img.src = res.thumbnailUrl;
          }
        })
        .catch(() => {});
    } else {
      addIconFallback(iconWrap, profile.name);
    }

    const body = document.createElement('div');
    body.className = 'cf-profile-body';

    const displayName = profile.name && String(profile.name).trim() ? profile.name : t('defaultProfile', 'Profil par défaut');

    const name = document.createElement('div');
    name.className = 'cf-profile-name';
    name.textContent = displayName;

    // Étiquette (traduite) selon le type de profil.
    const badge = document.createElement('span');
    const kind = kindOf(profile);
    if (kind === 'modpack') {
      badge.className = 'cf-badge cf-badge-modpack';
      badge.textContent = t('profiles.modpack', 'Modpack').toUpperCase();
    } else if (kind === 'vanilla') {
      badge.className = 'cf-badge cf-badge-vanilla';
      badge.textContent = t('profiles.vanilla', 'Vanilla').toUpperCase();
    } else {
      badge.className = 'cf-badge cf-badge-other';
      badge.textContent = t('profiles.other', 'Autre').toUpperCase();
    }
    name.appendChild(badge);

    const meta = document.createElement('div');
    meta.className = 'cf-profile-meta';
    const bits = [];
    if (profile.modpack && profile.modpack.mcVersion) bits.push('MC ' + profile.modpack.mcVersion);
    if (profile.modpack && profile.modpack.loader) {
      bits.push(profile.modpack.loader + (profile.modpack.loaderVersion ? ' ' + profile.modpack.loaderVersion : ''));
    } else if (profile.lastVersionId) {
      bits.push(profile.lastVersionId);
    }
    meta.textContent = bits.join('  •  ');

    body.appendChild(name);
    body.appendChild(meta);

    // Chemin du dossier : modpacks uniquement.
    if (profile.isModpack && profile.gameDir) {
      const dir = document.createElement('div');
      dir.className = 'cf-profile-dir';
      dir.textContent = profile.gameDir;
      body.appendChild(dir);
    }

    const actions = document.createElement('div');
    actions.className = 'cf-profile-actions';

    const playBtn = document.createElement('button');
    playBtn.className = 'primary-highlight cf-play-btn';
    playBtn.textContent = '▶ ' + t('play', 'Jouer');
    playBtn.addEventListener('click', async () => {
      window.GameSounds?.confirm();
      playBtn.disabled = true;
      const res = await window.api.mcpPlayProfile(profile.key);
      playBtn.disabled = false;
      if (res && res.ok && res.launched === false && res.message) {
        showWarning(res.message);
      } else if (res && !res.ok) {
        showWarning(res.error || t('profiles.launchFailed', 'Impossible de lancer ce profil.'));
      }
    });
    actions.appendChild(playBtn);

    // Bouton « Dossier » : modpacks uniquement.
    if (profile.isModpack && profile.gameDir) {
      const openBtn = document.createElement('button');
      openBtn.className = 'secondary';
      openBtn.textContent = '📂 ' + t('folder', 'Dossier');
      openBtn.addEventListener('click', () => window.api.mcpOpenPath(profile.gameDir));
      actions.appendChild(openBtn);
    }

    if (profile.isModpack) {
      const uninstallBtn = document.createElement('button');
      uninstallBtn.className = 'danger';
      uninstallBtn.textContent = '🗑 ' + t('uninstall', 'Désinstaller');
      uninstallBtn.addEventListener('click', async () => {
        const confirmed = confirm(
          t('profiles.uninstallConfirm1',
            `Désinstaller le modpack « ${profile.name} » ?\n\nCela retire le profil du launcher et supprime son dossier de jeu`,
            { name: profile.name }) +
          (profile.gameDir ? ` :\n${profile.gameDir}` : '.') +
          t('profiles.uninstallConfirmEnd', '\n\nCette action est irréversible.')
        );
        if (!confirmed) return;
        window.GameSounds?.back();
        uninstallBtn.disabled = true;
        const res = await window.api.mcpUninstallProfile(profile.key);
        if (res && res.ok) {
          if (res.warning) showWarning(res.warning);
          load();
        } else {
          uninstallBtn.disabled = false;
          showWarning((res && res.error) || t('profiles.uninstallFailed', 'Échec de la désinstallation.'));
        }
      });
      actions.appendChild(uninstallBtn);
    }

    card.appendChild(iconWrap);
    card.appendChild(body);
    card.appendChild(actions);
    return card;
  }

  function addIconFallback(wrap, name) {
    const fb = document.createElement('div');
    fb.className = 'cf-thumb-fallback';
    fb.textContent = (name && name[0] ? name[0] : '?').toUpperCase();
    wrap.appendChild(fb);
  }

  function render() {
    el.list.innerHTML = '';
    const shown = state.profiles.filter((p) => state.filter === 'all' || kindOf(p) === state.filter);

    if (state.profiles.length === 0) {
      el.empty.style.display = 'block';
      return;
    }
    el.empty.style.display = shown.length === 0 ? 'block' : 'none';
    for (const p of shown) el.list.appendChild(buildCard(p));
  }

  async function load() {
    const res = await window.api.mcpListProfiles();

    if (!res || !res.ok) {
      el.list.innerHTML = '';
      el.warning.style.display = 'block';
      el.warning.textContent = '⚠ ' + t('profiles.readFailed', 'Impossible de lire les profils du launcher.');
      return;
    }

    el.dirLabel.textContent = res.minecraftDir || '';

    if (!res.minecraftInstalled) {
      el.warning.style.display = 'block';
      el.warning.textContent = t('profiles.minecraftMissing',
        "⚠ Dossier .minecraft introuvable (" + res.minecraftDir + "). Installe et lance le launcher Minecraft officiel au moins une fois.",
        { dir: res.minecraftDir });
    } else {
      el.warning.style.display = 'none';
    }

    state.profiles = res.profiles || [];
    render();
  }

  // ---- Filtre par type ----
  if (el.filter) {
    el.filter.querySelectorAll('.mcp-filter-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        window.GameSounds?.toggle();
        state.filter = btn.getAttribute('data-filter') || 'all';
        el.filter.querySelectorAll('.mcp-filter-btn').forEach((b) => b.classList.toggle('active', b === btn));
        render();
      });
    });
  }

  el.refreshBtn.addEventListener('click', () => { window.GameSounds?.toggle(); load(); });

  // Re-rendu à un changement de langue (badges + boutons traduits).
  document.addEventListener('gg-langchange', () => { if (state.loaded) render(); });

  window.McProfilesPanel = {
    onShow() {
      if (state.loaded) return;
      state.loaded = true;
      load();
    },
    refresh() {
      state.loaded = true;
      return load();
    },
  };
})();
