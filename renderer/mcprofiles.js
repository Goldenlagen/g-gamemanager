'use strict';

// Onglet « Minecraft Profiles » : liste les profils du launcher Minecraft
// officiel (launcher_profiles.json), en mettant en avant ceux créés à partir
// d'un modpack CurseForge.
(function () {
  const state = { loaded: false };

  const el = {
    dirLabel: document.getElementById('mcpDirLabel'),
    warning: document.getElementById('mcpWarning'),
    list: document.getElementById('mcpProfilesList'),
    empty: document.getElementById('mcpEmpty'),
    refreshBtn: document.getElementById('mcpRefreshBtn'),
  };

  function isDataUri(icon) {
    return typeof icon === 'string' && icon.startsWith('data:');
  }

  function showWarning(text) {
    el.warning.textContent = '⚠ ' + text;
    el.warning.style.display = 'block';
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
    } else {
      addIconFallback(iconWrap, profile.name);
    }

    const body = document.createElement('div');
    body.className = 'cf-profile-body';

    const name = document.createElement('div');
    name.className = 'cf-profile-name';
    name.textContent = profile.name;

    // Étiquette selon le type de profil.
    const badge = document.createElement('span');
    const kind = profile.kind || (profile.isModpack ? 'modpack' : 'other');
    if (kind === 'modpack') {
      badge.className = 'cf-badge cf-badge-modpack';
      badge.textContent = 'MODPACK';
    } else if (kind === 'vanilla') {
      badge.className = 'cf-badge cf-badge-vanilla';
      badge.textContent = 'VANILLA';
    } else {
      badge.className = 'cf-badge cf-badge-other';
      badge.textContent = 'AUTRE';
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

    if (profile.gameDir) {
      const dir = document.createElement('div');
      dir.className = 'cf-profile-dir';
      dir.textContent = profile.gameDir;
      body.appendChild(dir);
    }

    const actions = document.createElement('div');
    actions.className = 'cf-profile-actions';

    const playBtn = document.createElement('button');
    playBtn.className = 'primary-highlight';
    playBtn.textContent = '▶ Jouer';
    playBtn.addEventListener('click', async () => {
      window.GameSounds?.confirm();
      playBtn.disabled = true;
      const res = await window.api.mcpPlayProfile(profile.key);
      playBtn.disabled = false;
      if (res && res.ok && res.launched === false && res.message) {
        showWarning(res.message);
      } else if (res && !res.ok) {
        showWarning(res.error || 'Impossible de lancer ce profil.');
      }
    });
    actions.appendChild(playBtn);

    if (profile.gameDir) {
      const openBtn = document.createElement('button');
      openBtn.className = 'secondary';
      openBtn.textContent = '📂 Dossier';
      openBtn.addEventListener('click', () => window.api.mcpOpenPath(profile.gameDir));
      actions.appendChild(openBtn);
    }

    if (profile.isModpack) {
      const uninstallBtn = document.createElement('button');
      uninstallBtn.className = 'danger';
      uninstallBtn.textContent = '🗑 Désinstaller';
      uninstallBtn.addEventListener('click', async () => {
        const confirmed = confirm(
          `Désinstaller le modpack « ${profile.name} » ?\n\nCela retire le profil du launcher et supprime son dossier de jeu` +
          (profile.gameDir ? ` :\n${profile.gameDir}` : '.') +
          '\n\nCette action est irréversible.'
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
          showWarning((res && res.error) || 'Échec de la désinstallation.');
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

  async function load() {
    const res = await window.api.mcpListProfiles();
    el.list.innerHTML = '';

    if (!res || !res.ok) {
      el.warning.style.display = 'block';
      el.warning.textContent = '⚠ Impossible de lire les profils du launcher.';
      return;
    }

    el.dirLabel.textContent = res.minecraftDir || '';

    if (!res.minecraftInstalled) {
      el.warning.style.display = 'block';
      el.warning.textContent =
        "⚠ Dossier .minecraft introuvable (" + res.minecraftDir + "). Installe et lance le launcher Minecraft officiel au moins une fois.";
    } else {
      el.warning.style.display = 'none';
    }

    if (!res.profiles || res.profiles.length === 0) {
      el.empty.style.display = 'block';
      return;
    }
    el.empty.style.display = 'none';

    for (const p of res.profiles) el.list.appendChild(buildCard(p));
  }

  el.refreshBtn.addEventListener('click', () => { window.GameSounds?.toggle(); load(); });

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
