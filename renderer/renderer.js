'use strict';

const PLATFORM_LABELS = {
  steam: 'Steam',
  epic: 'Epic Games',
  riot: 'Riot Games',
  gog: 'GOG',
  battlenet: 'Battle.net',
  origin: 'Origin / EA App',
  ubisoft: 'Ubisoft Connect',
  microsoft: 'Microsoft / Xbox',
  standalone: 'Sans launcher',
  manual: 'Ajouté manuellement',
};

// Traduction (repli sur le texte français / la clé si absente).
function tr(key, params) {
  const v = window.AppSettings ? window.AppSettings.t(key, params) : null;
  return v != null ? v : key;
}

// Libellé de plateforme : les noms de launchers restent tels quels ; seuls
// « Sans launcher » et « Ajouté manuellement » sont traduits.
function platformLabel(platform) {
  if (platform === 'standalone') return tr('platform.standalone');
  if (platform === 'manual') return tr('platform.manual');
  return PLATFORM_LABELS[platform] || platform;
}

const state = {
  allGames: [],
  displayedGames: [],
  selectedIndex: -1,
  pendingManualGame: null, // { exePath, defaultName } en attente de confirmation du nom
  isLoading: false,
  lastSync: null,
};

const el = {
  grid: document.getElementById('gamesGrid'),
  loadingOverlay: document.getElementById('loadingOverlay'),
  emptyState: document.getElementById('emptyState'),
  searchBox: document.getElementById('searchBox'),
  platformFilter: document.getElementById('platformFilter'),
  refreshBtn: document.getElementById('refreshBtn'),
  addGameBtn: document.getElementById('addGameBtn'),
  minimizeBtn: document.getElementById('minimizeBtn'),
  startupCheckbox: document.getElementById('startupCheckbox'),
  standaloneScanCheckbox: document.getElementById('standaloneScanCheckbox'),
  manualGamesList: document.getElementById('manualGamesList'),
  addGameModal: document.getElementById('addGameModal'),
  addGameNameInput: document.getElementById('addGameNameInput'),
  addGamePathLabel: document.getElementById('addGamePathLabel'),
  addGameConfirmBtn: document.getElementById('addGameConfirmBtn'),
  addGameCancelBtn: document.getElementById('addGameCancelBtn'),
  lastSyncInfo: document.getElementById('lastSyncInfo'),
  detailPanel: document.getElementById('gameDetailPanel'),
  detailArt: document.getElementById('gameDetailArt'),
  detailName: document.getElementById('gameDetailName'),
  detailPlatform: document.getElementById('gameDetailPlatform'),
  detailPlayBtn: document.getElementById('gameDetailPlayBtn'),
  detailArtworkBtn: document.getElementById('gameDetailArtworkBtn'),
  detailArtworkResetBtn: document.getElementById('gameDetailArtworkResetBtn'),
  detailArtworkStatus: document.getElementById('gameDetailArtworkStatus'),
  sgdbKeyInput: document.getElementById('sgdbKeyInput'),
  autoUpdateToggle: document.getElementById('autoUpdateToggle'),
  updateCurrentVersion: document.getElementById('updateCurrentVersion'),
  updateCheckBtn: document.getElementById('updateCheckBtn'),
  updateDownloadBtn: document.getElementById('updateDownloadBtn'),
  updateInstallBtn: document.getElementById('updateInstallBtn'),
  updateStatus: document.getElementById('updateStatus'),
};

// Clé stable d'un jeu pour les jaquettes personnalisées (doit correspondre à main.js).
function gameKey(game) {
  return `${game.platform}:${game.name}`;
}

// ---------- Rendu de la grille ----------

function renderGrid() {
  el.grid.innerHTML = '';

  // En-têtes de section par plateforme : uniquement utiles quand plusieurs
  // launchers sont mélangés dans la vue actuelle (pas quand on a filtré sur
  // une seule plateforme, ni quand une recherche ne renvoie que des jeux d'un
  // seul launcher).
  const distinctPlatforms = new Set(state.displayedGames.map((g) => g.platform));
  const showHeaders = distinctPlatforms.size > 1;
  let lastPlatform = null;

  for (let i = 0; i < state.displayedGames.length; i++) {
    const game = state.displayedGames[i];

    if (showHeaders && game.platform !== lastPlatform) {
      const header = document.createElement('div');
      header.className = 'platform-section-header';
      header.textContent = platformLabel(game.platform);
      el.grid.appendChild(header);
      lastPlatform = game.platform;
    }

    const tile = document.createElement('div');
    tile.className = 'game-tile';
    tile.tabIndex = -1;
    tile.dataset.index = String(i);
    if (i === state.selectedIndex) tile.classList.add('selected');

    const iconWrap = document.createElement('div');
    iconWrap.className = 'game-tile-icon';

    let fallbackEl = null;
    function showFallbackLetter() {
      if (fallbackEl) return; // déjà affichée
      fallbackEl = document.createElement('div');
      fallbackEl.className = 'fallback-letter';
      fallbackEl.textContent = (game.name[0] || '?').toUpperCase();
      iconWrap.appendChild(fallbackEl);
    }

    function onIconLoadError() {
      // Même l'icône locale a échoué à charger (fichier corrompu, etc.) :
      // repli final sur la lettre.
      img.remove();
      showFallbackLetter();
    }

    let img = null;
    if (game.boxArtUrl || game.iconUrl) {
      img = document.createElement('img');
      img.alt = '';

      if (game.boxArtUrl) {
        // Jaquette officielle en premier : belle image "cover" plein cadre.
        img.src = game.boxArtUrl;
        img.addEventListener('error', () => {
          // Le CDN Steam ne fournit pas cet asset pour tous les jeux (ou hors-ligne) :
          // on retombe sur l'icône locale, affichée cette fois en mode "contain".
          if (game.iconUrl) {
            img.classList.add('contain');
            img.addEventListener('error', onIconLoadError, { once: true });
            img.src = game.iconUrl;
          } else {
            onIconLoadError();
          }
        }, { once: true });
      } else {
        img.classList.add('contain');
        img.addEventListener('error', onIconLoadError, { once: true });
        img.src = game.iconUrl;
      }

      iconWrap.appendChild(img);
    } else {
      // Aucune image disponible du tout pour ce jeu : lettre directement.
      showFallbackLetter();
    }

    const nameEl = document.createElement('div');
    nameEl.className = 'game-tile-name';
    nameEl.textContent = game.name;

    const platformEl = document.createElement('div');
    platformEl.className = 'game-tile-platform';
    platformEl.textContent = platformLabel(game.platform);

    tile.appendChild(iconWrap);
    tile.appendChild(nameEl);
    tile.appendChild(platformEl);

    // Un simple clic sélectionne le jeu (et fait apparaître le panneau de
    // détails à droite). Le lancement se fait via le bouton « Jouer » de ce
    // panneau — plus de double-clic.
    tile.addEventListener('click', () => {
      if (state.isLoading) return;
      if (state.selectedIndex !== i) {
        state.selectedIndex = i;
        updateSelectionClasses();
      }
      window.GameSounds?.select();
    });

    el.grid.appendChild(tile);
  }

  el.emptyState.style.display = state.displayedGames.length === 0 ? 'flex' : 'none';

  // Plus de sélection par défaut : le panneau de détails n'apparaît qu'après
  // un clic (ou une navigation clavier/manette) de l'utilisateur.
  renderDetailPanel();
}

function updateSelectionClasses() {
  const tiles = el.grid.querySelectorAll('.game-tile');
  tiles.forEach((t, i) => {
    t.classList.toggle('selected', i === state.selectedIndex);
  });

  const selectedTile = el.grid.querySelector('.game-tile.selected');
  if (selectedTile) selectedTile.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

  renderDetailPanel();
}

// Panneau de détails du jeu sélectionné (à droite). Masqué si aucun jeu
// n'est sélectionné.
function renderDetailPanel() {
  const game = state.displayedGames[state.selectedIndex];
  if (!game || state.selectedIndex < 0) {
    el.detailPanel.hidden = true;
    return;
  }

  el.detailArt.innerHTML = '';
  const letter = () => {
    const fb = document.createElement('div');
    fb.className = 'fallback-letter';
    fb.textContent = (game.name[0] || '?').toUpperCase();
    el.detailArt.appendChild(fb);
  };

  if (game.boxArtUrl || game.iconUrl) {
    const img = document.createElement('img');
    img.alt = '';
    if (game.boxArtUrl) {
      img.src = game.boxArtUrl;
      img.addEventListener('error', () => {
        if (game.iconUrl) {
          img.classList.add('contain');
          img.addEventListener('error', () => { img.remove(); letter(); }, { once: true });
          img.src = game.iconUrl;
        } else {
          img.remove();
          letter();
        }
      }, { once: true });
    } else {
      img.classList.add('contain');
      img.addEventListener('error', () => { img.remove(); letter(); }, { once: true });
      img.src = game.iconUrl;
    }
    el.detailArt.appendChild(img);
  } else {
    letter();
  }

  el.detailName.textContent = game.name;
  el.detailPlatform.textContent = platformLabel(game.platform);
  el.detailPanel.hidden = false;
}

// ---------- Filtrage ----------

// Doit correspondre à l'ordre utilisé côté backend (scanners/scanAll.js) — dupliqué
// ici volontairement : l'affichage se re-regroupe lui-même par plateforme après
// filtrage, sans dépendre de l'ordre déjà reçu, pour rester correct même si les
// données proviennent d'un cache antérieur à ce regroupement (pas de resynchronisation
// nécessaire pour corriger l'affichage).
const PLATFORM_ORDER = [
  'steam', 'epic', 'gog', 'battlenet', 'origin', 'ubisoft', 'riot', 'microsoft', 'standalone', 'manual',
];

function platformRank(platform) {
  const idx = PLATFORM_ORDER.indexOf(platform);
  return idx === -1 ? PLATFORM_ORDER.length : idx;
}

function applyFilters() {
  const search = el.searchBox.value.trim().toLowerCase();
  const platform = el.platformFilter.value;

  state.displayedGames = state.allGames
    .filter((g) => {
      const matchesSearch = !search || g.name.toLowerCase().includes(search);
      const matchesPlatform = platform === 'all' || g.platform === platform;
      return matchesSearch && matchesPlatform;
    })
    .sort((a, b) => platformRank(a.platform) - platformRank(b.platform)); // tri stable : conserve l'ordre alphabétique au sein de chaque groupe

  // Pas de sélection par défaut : on repart sans jeu sélectionné à chaque
  // (re)filtrage. L'utilisateur choisit lui-même.
  state.selectedIndex = -1;
  renderGrid();
}

// ---------- Scan ----------

function setLoadingUiState(isLoading) {
  state.isLoading = isLoading;

  el.loadingOverlay.style.display = isLoading ? 'flex' : 'none';
  el.grid.classList.toggle('locked', isLoading);

  // On désactive aussi les actions de la barre du haut : impossible d'ajouter un
  // jeu, de rouvrir les paramètres ou de relancer une resynchronisation pendant
  // qu'une synchronisation est déjà en cours.
  el.addGameBtn.disabled = isLoading;
  el.refreshBtn.disabled = isLoading;
  el.searchBox.disabled = isLoading;
  el.platformFilter.disabled = isLoading;

  // Verrouille aussi le changement d'onglet (Minecraft/Ark/Performance...) : la
  // synchronisation bloque toute l'appli, pas seulement la grille de jeux.
  document.querySelector('.app-tabs')?.classList.toggle('locked', isLoading);
}

function formatSyncDate(timestamp) {
  if (!timestamp) return tr('games.never');
  const loc = window.AppSettings && window.AppSettings.getLang() === 'en' ? 'en-GB' : 'fr-FR';
  return new Date(timestamp).toLocaleString(loc, {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function updateLastSyncLabel() {
  if (el.lastSyncInfo) {
    el.lastSyncInfo.textContent = `${tr('games.lastSyncLabel')} ${formatSyncDate(state.lastSync)}`;
  }
}

async function refreshGames(forceRescan = false) {
  if (state.isLoading) return; // une synchronisation est déjà en cours, on ignore
  setLoadingUiState(true);

  try {
    const result = await window.api.scanGames(forceRescan);
    state.allGames = result.games;
    state.lastSync = result.lastSync;
    updateLastSyncLabel();
    applyFilters();
  } finally {
    setLoadingUiState(false);
  }
}

// ---------- Lancement ----------

function launchGame(game) {
  if (!game || state.isLoading) return;
  window.GameSounds?.playGame();
  window.api.launchGame(game);
}

// ---------- Navigation spatiale (clavier + manette) ----------
//
// Les tuiles sont disposées dans une grille en wrap ; on calcule les positions
// visuelles réelles (getBoundingClientRect) pour trouver la tuile la plus proche
// dans la direction demandée, plutôt que de se limiter à l'ordre du tableau.

function moveSelection(direction) {
  if (state.isLoading || state.displayedGames.length === 0) return;

  const tiles = Array.from(el.grid.querySelectorAll('.game-tile'));
  if (state.selectedIndex < 0 || state.selectedIndex >= tiles.length) {
    state.selectedIndex = 0;
    updateSelectionClasses();
    window.GameSounds?.navigate();
    return;
  }

  const previousIndex = state.selectedIndex;
  const current = tiles[state.selectedIndex];
  const currentRect = current.getBoundingClientRect();
  const cx = currentRect.left + currentRect.width / 2;
  const cy = currentRect.top + currentRect.height / 2;

  let best = null;
  let bestScore = Infinity;

  for (let i = 0; i < tiles.length; i++) {
    if (i === state.selectedIndex) continue;
    const r = tiles[i].getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const dx = x - cx;
    const dy = y - cy;

    let primary;
    let ok;
    switch (direction) {
      case 'right': ok = dx > 4; primary = dx; break;
      case 'left': ok = dx < -4; primary = -dx; break;
      case 'down': ok = dy > 4; primary = dy; break;
      case 'up': ok = dy < -4; primary = -dy; break;
      default: ok = false;
    }
    if (!ok) continue;

    const secondary = direction === 'left' || direction === 'right' ? Math.abs(dy) : Math.abs(dx);
    const score = primary + secondary * 2; // on pénalise fortement le désalignement

    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }

  // Repli : si rien trouvé dans la direction exacte (ex: bout de ligne), on
  // avance/recule simplement dans l'ordre de la grille pour ne jamais rester bloqué.
  if (best === null) {
    if (direction === 'right' || direction === 'down') best = Math.min(state.selectedIndex + 1, tiles.length - 1);
    else if (direction === 'left' || direction === 'up') best = Math.max(state.selectedIndex - 1, 0);
  }

  if (best !== null) {
    state.selectedIndex = best;
    updateSelectionClasses();
    if (state.selectedIndex !== previousIndex) window.GameSounds?.navigate();
  }
}

// ---------- Clavier ----------

document.addEventListener('keydown', (e) => {
  if (state.isLoading) {
    // Seule la réduction dans la zone de notification reste possible pendant
    // une synchronisation (comme le bouton "—", volontairement laissé actif) :
    // le reste de l'appli (onglets, grille, recherche...) est verrouillé.
    if (e.key === 'Escape') {
      window.GameSounds?.back();
      window.api.minimizeToTray();
      e.preventDefault();
    }
    return;
  }
  // Si une modale ou le champ de recherche a le focus, on laisse le comportement par défaut.
  if (el.addGameModal.style.display !== 'none') return;
  if (document.activeElement === el.searchBox) {
    if (e.key === 'Escape') el.searchBox.blur();
    return;
  }

  // Si l'utilisateur tape dans un champ quelconque (console Minecraft/Ark/SteamCMD,
  // formulaires de paramètres, etc.), on ne doit surtout pas intercepter la touche
  // Entrée pour lancer le jeu actuellement sélectionné dans la grille — ce champ
  // gère déjà lui-même ses propres touches.
  const active = document.activeElement;
  const isTypingElsewhere =
    active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT' || active.isContentEditable);
  if (isTypingElsewhere) return;

  // De même, la navigation/lancement de la grille de jeux n'a de sens que sur
  // l'onglet Jeux : on l'ignore si un autre onglet (Minecraft/Ark) est actif.
  // Échap reste global (réduction dans la zone de notification, quel que soit l'onglet).
  const gamesViewActive = document.getElementById('view-games')?.classList.contains('active');

  switch (e.key) {
    case 'ArrowRight': if (gamesViewActive) { moveSelection('right'); e.preventDefault(); } break;
    case 'ArrowLeft': if (gamesViewActive) { moveSelection('left'); e.preventDefault(); } break;
    case 'ArrowDown': if (gamesViewActive) { moveSelection('down'); e.preventDefault(); } break;
    case 'ArrowUp': if (gamesViewActive) { moveSelection('up'); e.preventDefault(); } break;
    case 'Enter':
      if (gamesViewActive) { launchGame(state.displayedGames[state.selectedIndex]); e.preventDefault(); }
      break;
    case 'Escape': {
      const settingsModal = document.getElementById('appSettingsModal');
      if (settingsModal && settingsModal.style.display !== 'none') {
        window.GameSounds?.toggle();
        settingsModal.style.display = 'none';
      } else {
        window.GameSounds?.back();
        window.api.minimizeToTray();
      }
      e.preventDefault();
      break;
    }
    case 'f':
    case 'F':
      if (gamesViewActive && e.ctrlKey) { el.searchBox.focus(); el.searchBox.select(); e.preventDefault(); }
      break;
  }
});

// ---------- Manette (API Gamepad du navigateur, native à Electron/Chromium) ----------

const gamepadState = {
  prevButtons: {},
  prevAxisUp: false,
  prevAxisDown: false,
  prevAxisLeft: false,
  prevAxisRight: false,
};

const AXIS_DEADZONE = 0.5;

function pollGamepad() {
  if (state.isLoading) return; // synchronisation en cours : aucune interaction possible
  const gamesViewActive = document.getElementById('view-games')?.classList.contains('active');
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const pad of pads) {
    if (!pad) continue;

    if (gamesViewActive) {
      // Croix directionnelle (mapping standard : 12=haut, 13=bas, 14=gauche, 15=droite)
      checkButtonEdge(pad, 12, () => moveSelection('up'));
      checkButtonEdge(pad, 13, () => moveSelection('down'));
      checkButtonEdge(pad, 14, () => moveSelection('left'));
      checkButtonEdge(pad, 15, () => moveSelection('right'));
      // Bouton A (0) = valider
      checkButtonEdge(pad, 0, () => launchGame(state.displayedGames[state.selectedIndex]));
    }
    // Bouton B (1) = retour/réduire : reste global, quel que soit l'onglet actif.
    checkButtonEdge(pad, 1, () => { window.GameSounds?.back(); window.api.minimizeToTray(); });

    // Stick gauche
    const x = pad.axes[0] || 0;
    const y = pad.axes[1] || 0;

    const up = y < -AXIS_DEADZONE;
    const down = y > AXIS_DEADZONE;
    const left = x < -AXIS_DEADZONE;
    const right = x > AXIS_DEADZONE;

    if (gamesViewActive) {
      if (up && !gamepadState.prevAxisUp) moveSelection('up');
      if (down && !gamepadState.prevAxisDown) moveSelection('down');
      if (left && !gamepadState.prevAxisLeft) moveSelection('left');
      if (right && !gamepadState.prevAxisRight) moveSelection('right');
    }

    gamepadState.prevAxisUp = up;
    gamepadState.prevAxisDown = down;
    gamepadState.prevAxisLeft = left;
    gamepadState.prevAxisRight = right;

    break; // une seule manette active à la fois
  }
}

function checkButtonEdge(pad, index, onPress) {
  const btn = pad.buttons[index];
  if (!btn) return;
  const key = pad.index + ':' + index;
  const wasPressed = gamepadState.prevButtons[key] || false;
  if (btn.pressed && !wasPressed) onPress();
  gamepadState.prevButtons[key] = btn.pressed;
}

setInterval(pollGamepad, 100);

// ---------- Paramètres ----------

async function refreshManualGamesList() {
  const entries = await window.api.getManualGames();
  el.manualGamesList.innerHTML = '';

  for (const entry of entries) {
    const row = document.createElement('div');
    row.className = 'manual-game-row';

    const name = document.createElement('span');
    name.textContent = entry.name;

    const removeBtn = document.createElement('button');
    removeBtn.textContent = tr('common.remove');
    removeBtn.addEventListener('click', async () => {
      await window.api.removeManualGame(entry.exePath);
      await refreshManualGamesList();
      await refreshGames(true); // on force : le retrait doit être immédiat, pas d'attente du cache
    });

    row.appendChild(name);
    row.appendChild(removeBtn);
    el.manualGamesList.appendChild(row);
  }
}

// Les réglages « Jeux » vivent maintenant dans la fenêtre Paramètres globale
// (bouton ⚙ en haut à droite, géré par appsettings.js). On expose un hook pour
// rafraîchir la liste des jeux manuels à l'ouverture de cette fenêtre.
window.GamesSettings = { refresh: refreshManualGamesList };

el.startupCheckbox.addEventListener('change', () => {
  window.api.setStartupEnabled(el.startupCheckbox.checked);
});

el.standaloneScanCheckbox.addEventListener('change', () => {
  window.api.settingsSet('standaloneGameScanEnabled', el.standaloneScanCheckbox.checked);
});

// Clé API SteamGridDB : enregistrée à la perte de focus / validation.
if (el.sgdbKeyInput) {
  const saveKey = () => window.api.settingsSet('steamGridDbKey', el.sgdbKeyInput.value.trim());
  el.sgdbKeyInput.addEventListener('change', saveKey);
  el.sgdbKeyInput.addEventListener('blur', saveKey);
}

// ---------- Mise à jour automatique ----------

const t = (key, params) => (window.AppSettings ? window.AppSettings.t(key, params) : key);

function renderUpdateStatus(s) {
  if (!el.updateStatus) return;
  const state = s && s.state;
  let msg = '';
  let showDownload = false;
  let showInstall = false;
  switch (state) {
    case 'checking': msg = t('update.checking'); break;
    case 'available':
      msg = t('update.available', { version: s.version || '' });
      showDownload = true;
      break;
    case 'not-available': msg = t('update.upToDate'); break;
    case 'downloading':
      msg = t('update.downloading', { percent: (s.percent != null ? s.percent : 0) });
      break;
    case 'downloaded':
      msg = t('update.downloaded', { version: s.version || '' });
      showInstall = true;
      break;
    case 'error': msg = t('update.error', { detail: s.detail || '' }); break;
    case 'disabled':
      msg = s.reason === 'dev' ? t('update.disabledDev') : t('update.disabled');
      break;
    default: msg = '';
  }
  el.updateStatus.textContent = msg;
  if (el.updateDownloadBtn) el.updateDownloadBtn.hidden = !showDownload;
  if (el.updateInstallBtn) el.updateInstallBtn.hidden = !showInstall;
}

if (el.autoUpdateToggle) {
  el.autoUpdateToggle.addEventListener('change', () => {
    window.api.settingsSet('autoUpdateCheck', el.autoUpdateToggle.checked);
  });
}
if (el.updateCheckBtn) {
  el.updateCheckBtn.addEventListener('click', async () => {
    renderUpdateStatus({ state: 'checking' });
    const res = await window.api.updateCheck();
    renderUpdateStatus(res);
  });
}
if (el.updateDownloadBtn) {
  el.updateDownloadBtn.addEventListener('click', () => window.api.updateDownload());
}
if (el.updateInstallBtn) {
  el.updateInstallBtn.addEventListener('click', () => window.api.updateInstall());
}
// Événements poussés par le processus principal (progression, disponibilité...).
if (window.api.onUpdateStatus) window.api.onUpdateStatus(renderUpdateStatus);

// ---------- Ajout manuel de jeu ----------

el.addGameBtn.addEventListener('click', async () => {
  window.GameSounds?.toggle();
  const result = await window.api.addManualGame();
  if (!result) return;

  if (result.error === 'shortcut') {
    alert(tr('games.shortcutError'));
    return;
  }

  state.pendingManualGame = result;
  el.addGameNameInput.value = result.defaultName;
  el.addGamePathLabel.textContent = result.exePath;
  el.addGameModal.style.display = 'flex';
  el.addGameNameInput.focus();
  el.addGameNameInput.select();
});

el.addGameCancelBtn.addEventListener('click', () => {
  el.addGameModal.style.display = 'none';
  state.pendingManualGame = null;
});

el.addGameConfirmBtn.addEventListener('click', async () => {
  const name = el.addGameNameInput.value.trim();
  if (!name || !state.pendingManualGame) return;

  window.GameSounds?.confirm();
  await window.api.confirmManualGame(name, state.pendingManualGame.exePath);
  el.addGameModal.style.display = 'none';
  state.pendingManualGame = null;

  await refreshGames(true); // on force : le nouveau jeu doit apparaître immédiatement
  await refreshManualGamesList();
});

// ---------- Autres actions ----------

el.refreshBtn.addEventListener('click', () => { window.GameSounds?.toggle(); refreshGames(true); });
el.minimizeBtn.addEventListener('click', () => { window.GameSounds?.back(); window.api.minimizeToTray(); });

// Bouton « Jouer » du panneau de détails : joue le son (playGame, celui qui
// était prévu au double-clic) puis lance le jeu sélectionné.
el.detailPlayBtn.addEventListener('click', () => {
  if (state.isLoading) return;
  const game = state.displayedGames[state.selectedIndex];
  if (game) launchGame(game);
});

// Jaquette SteamGridDB pour le jeu sélectionné.
el.detailArtworkBtn.addEventListener('click', async () => {
  const game = state.displayedGames[state.selectedIndex];
  if (!game) return;
  el.detailArtworkBtn.disabled = true;
  el.detailArtworkStatus.textContent = tr('games.artworkSearching');
  try {
    const res = await window.api.sgdbFetch(gameKey(game), game.name);
    if (res && res.ok) {
      game.boxArtUrl = res.cover;
      renderGrid();
      renderDetailPanel();
      el.detailArtworkStatus.textContent = tr('games.artworkDone');
    } else {
      const map = {
        noKey: tr('games.artworkNoKey'),
        notFound: tr('games.artworkNotFound'),
        noArtwork: tr('games.artworkNotFound'),
      };
      el.detailArtworkStatus.textContent = (res && map[res.error]) || tr('games.artworkError');
    }
  } catch (e) {
    el.detailArtworkStatus.textContent = tr('games.artworkError');
  } finally {
    el.detailArtworkBtn.disabled = false;
  }
});

el.detailArtworkResetBtn.addEventListener('click', async () => {
  const game = state.displayedGames[state.selectedIndex];
  if (!game) return;
  await window.api.sgdbClear(gameKey(game));
  game.boxArtUrl = null; // revient à l'icône d'origine
  renderGrid();
  renderDetailPanel();
  el.detailArtworkStatus.textContent = '';
});

el.searchBox.addEventListener('input', applyFilters);
el.platformFilter.addEventListener('change', applyFilters);

// ---------- Bascule entre les onglets Jeux / Minecraft / Ark ----------

document.querySelectorAll('.app-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    if (tab.classList.contains('active')) return;
    if (state.isLoading) return; // synchronisation en cours : on ne change pas d'onglet
    window.GameSounds?.toggle();

    const previousTab = document.querySelector('.app-tab.active');
    const previousView = previousTab?.dataset.view;

    document.querySelectorAll('.app-tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));

    tab.classList.add('active');
    const view = document.getElementById(`view-${tab.dataset.view}`);
    if (view) view.classList.add('active');

    // On informe le panneau qu'on vient de quitter qu'il devient invisible
    // (arrête par exemple le polling périodique de l'onglet Performance).
    if (previousView === 'dashboard') { window.DashboardPanel?.onHide(); window.PerformancePanel?.onHide(); }

    // On informe les modules qu'ils deviennent visibles, pour qu'ils chargent
    // leurs données (ou démarrent leur polling) au moment de l'affichage
    // plutôt qu'au démarrage de l'appli.
    if (tab.dataset.view === 'minecraft') activateMinecraftSub(currentMinecraftSub);
    if (tab.dataset.view === 'ark') window.ArkPanel?.onShow();
    if (tab.dataset.view === 'steamcmd') window.SteamCmdPanel?.onShow();
    if (tab.dataset.view === 'dashboard') { window.DashboardPanel?.onShow(); window.PerformancePanel?.onShow(); }
  });
});

// ---------- Sous-onglets Minecraft (Profils / Serveurs) ----------

let currentMinecraftSub = 'mcprofiles';

function activateMinecraftSub(sub) {
  currentMinecraftSub = sub === 'mcservers' ? 'mcservers' : 'mcprofiles';
  document.querySelectorAll('#view-minecraft .subtab').forEach((b) => {
    b.classList.toggle('active', b.dataset.subtab === currentMinecraftSub);
  });
  const profiles = document.getElementById('subview-mcprofiles');
  const servers = document.getElementById('subview-mcservers');
  if (profiles) profiles.classList.toggle('active', currentMinecraftSub === 'mcprofiles');
  if (servers) servers.classList.toggle('active', currentMinecraftSub === 'mcservers');

  if (currentMinecraftSub === 'mcprofiles') window.McProfilesPanel?.onShow();
  else window.MinecraftPanel?.onShow();
}

document.querySelectorAll('#view-minecraft .subtab').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (btn.classList.contains('active')) return;
    window.GameSounds?.toggle();
    activateMinecraftSub(btn.dataset.subtab);
  });
});

// ---------- Changement de langue ----------

// Retraduit les libellés construits en JS (en-têtes/plateformes des tuiles,
// date de dernière synchronisation, liste des jeux manuels).
document.addEventListener('gg-langchange', () => {
  renderGrid();
  updateLastSyncLabel();
  if (document.getElementById('appSettingsModal')?.style.display !== 'none') {
    refreshManualGamesList();
  }
});

// ---------- Démarrage ----------

(async function init() {
  el.startupCheckbox.checked = await window.api.getStartupEnabled();
  const settings = await window.api.settingsGet();
  el.standaloneScanCheckbox.checked = settings.standaloneGameScanEnabled;
  if (el.sgdbKeyInput) el.sgdbKeyInput.value = settings.steamGridDbKey || '';
  if (el.autoUpdateToggle) el.autoUpdateToggle.checked = settings.autoUpdateCheck !== false;
  try {
    const upd = await window.api.updateGetStatus();
    if (el.updateCurrentVersion) el.updateCurrentVersion.textContent = upd.currentVersion || '—';
    if (!upd.operational) renderUpdateStatus({ state: 'disabled', reason: upd.packaged ? 'module' : 'dev' });
  } catch (_) { /* backend indisponible */ }
  await refreshGames();
})();
