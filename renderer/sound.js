'use strict';

// Bruitages de l'interface à partir de fichiers audio (dossier sound/ à la
// racine du projet). Sons :
//   - TabButton.mp3      : onglets (principaux + sous-onglets Minecraft)
//   - GameSelect.mp3     : sélection d'un jeu (clic sur une tuile + navigation)
//   - ServerItem.mp3     : ouverture des détails d'un serveur (Minecraft / Ark)
//   - PlayGameSound.mp3  : lancement d'un jeu / profil (bouton « Jouer »)
// Les autres boutons ne jouent AUCUN son (retiré à la demande).
(function () {
  // Le renderer est chargé depuis renderer/index.html : les MP3 sont un cran
  // au-dessus, dans C:\...\g-gamemanager\sound.
  const BASE = '../sound/';
  const FILES = {
    tab: 'TabButton.mp3',
    gameSelect: 'GameSelect.mp3',
    serverItem: 'ServerItem.mp3',
    playGame: 'PlayGameSound.mp3',
  };
  const VOLUME = 0.5;

  // Préchargement (réchauffe le cache du navigateur pour un déclenchement
  // instantané ensuite). On garde une instance de référence par son.
  const warm = {};
  function preload() {
    for (const key of Object.keys(FILES)) {
      try {
        const a = new Audio(BASE + FILES[key]);
        a.preload = 'auto';
        a.volume = VOLUME;
        warm[key] = a;
      } catch (e) {
        /* Audio indisponible : on ignore, l'appli reste utilisable sans son */
      }
    }
  }
  preload();

  // On crée une nouvelle instance à chaque lecture : ça permet des déclenchements
  // rapprochés qui se superposent proprement (ex: défilement rapide) sans couper
  // le son précédent. Le fichier étant déjà en cache, c'est instantané.
  function play(key) {
    if (!FILES[key]) return;
    try {
      const a = new Audio(BASE + FILES[key]);
      a.volume = VOLUME;
      const p = a.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (e) {
      /* lecture bloquée/indisponible : silencieux */
    }
  }

  window.GameSounds = {
    // Sons nommés.
    tab() { play('tab'); },
    gameSelect() { play('gameSelect'); },
    serverItem() { play('serverItem'); },
    playGame() { play('playGame'); },

    // Compatibilité avec le code existant :
    // - la sélection / navigation dans les jeux passe par select()/navigate().
    select() { play('gameSelect'); },
    navigate() { play('gameSelect'); },
    // - les clics de boutons ne jouent plus de son : ces méthodes restent
    //   présentes (silencieuses) pour ne pas casser le code appelant.
    button() {},
    confirm() {},
    toggle() {},
    back() {},
  };

  // Écouteur global des clics, en phase de capture. On ne sonorise ici que les
  // onglets et le lancement d'un profil ; les jeux et les cartes serveurs
  // jouent leur son via leurs propres handlers, et les autres boutons sont muets.
  document.addEventListener(
    'click',
    (e) => {
      const t = e.target;
      if (!t || !t.closest) return;
      // Onglets principaux (Jeux/Minecraft/Ark/...) et sous-onglets Minecraft.
      if (t.closest('.app-tab') || t.closest('.subtab')) { play('tab'); return; }
      // Bouton « Jouer » d'un profil : son de lancement (jeux → inchangé).
      if (t.closest('.cf-play-btn')) { play('playGame'); return; }
      // Rien d'autre : le bouton « Jouer » du panneau de détails joue déjà
      // playGame via son handler, les tuiles de jeux jouent gameSelect via
      // renderer.js, et tous les autres boutons restent silencieux.
    },
    true
  );
})();
