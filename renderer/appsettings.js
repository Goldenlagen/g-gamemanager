'use strict';

// Réglages globaux de l'application : thème clair/sombre et langue FR/EN.
// Chargé tôt (dans <head>) pour appliquer le thème avant le premier rendu.
(function () {
  const root = document.documentElement;

  const STORE_THEME = 'gg-theme';
  const STORE_LANG = 'gg-lang';

  function readStore(key, fallback) {
    try {
      return localStorage.getItem(key) || fallback;
    } catch (e) {
      return fallback;
    }
  }
  function writeStore(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      /* ignore */
    }
  }

  let theme = readStore(STORE_THEME, 'dark');
  let lang = readStore(STORE_LANG, 'fr');

  // Application immédiate du thème/langue sur <html> (avant que le body existe).
  root.dataset.theme = theme;
  root.dataset.lang = lang;

  // ---- Dictionnaire de traduction (interface principale) ----
  const I18N = {
    fr: {
      'tab.games': '🎮 Jeux',
      'tab.minecraft': 'Serveurs Minecraft',
      'tab.minecraftGroup': 'Minecraft',
      'tab.mcprofiles': 'Profils Minecraft',
      'tab.ark': 'ARK Survival',
      'tab.steamcmd': 'SteamCMD',
      'tab.performance': 'Performance',
      'tab.dashboard': '🖥️ Tableau de bord',
      'dash.empty': 'Aucun serveur détecté. Configure tes serveurs dans les onglets Minecraft, Ark ou SteamCMD.',
      'dash.running': 'En cours',
      'dash.starting': 'Démarrage…',
      'dash.stopped': 'Arrêté',
      'dash.error': 'Erreur',
      'dash.ram': 'RAM :',
      'dash.cpu': 'CPU :',
      'dash.start': '▶ Démarrer',
      'dash.stop': '■ Arrêter',
      'dash.force': '⛔ Forcer',
      'dash.forceTitle': "Forcer l'arrêt (tue tout l'arbre de processus)",
      'dash.forceConfirm': "Forcer l'arrêt de « {name} » ? Les données non sauvegardées peuvent être perdues.",
      'dash.open': 'Ouvrir',
      'dash.autostart': 'Auto-démarrage',
      'dash.autorestart': 'Redémarrage auto au crash',
      'dash.restartEvery': 'Redémarrage toutes les',
      'dash.hoursUnit': 'h',
      'dash.updated': 'Mis à jour à',
      'dash.serversTitle': 'Serveurs',
      'dash.filterAll': 'Tous',
      'defaultProfile': 'Profil par défaut',
      'settings.title': 'Paramètres',
      'settings.theme': 'Thème',
      'settings.light': 'Clair',
      'settings.dark': 'Sombre',
      'settings.language': 'Langue',
      'settings.gamesSection': 'Jeux',
      'settings.startup': 'Lancer au démarrage de Windows',
      'settings.standalone': 'Détecter les jeux installés sans launcher (expérimental)',
      'settings.standaloneHint':
        "Recherche des jeux installés directement (sans Steam/Epic/etc.) via le registre Windows. Best-effort : peut inclure quelques logiciels qui ne sont pas des jeux. Désactivé par défaut. Nécessite une resynchronisation pour prendre effet.",
      'settings.manualGames': 'Jeux ajoutés manuellement',
      'settings.manualHint':
        "Astuce : si un jeu (notamment Riot Games ou Battle.net) n'est pas détecté automatiquement, ajoute-le manuellement via « + Ajouter un jeu ».",
      'common.refresh': '⟳ Rafraîchir',
      'games.platform': 'Plateforme :',
      'games.allGames': 'Tous les jeux',
      'games.searchLabel': 'Rechercher :',
      'games.searchPh': 'Nom du jeu…',
      'games.resync': '⟳ Resynchroniser',
      'games.addGame': '+ Ajouter un jeu',
      'server.delete': '🗑 Supprimer le serveur',
      "common.chooseFolder": "📁 Choisir le dossier",
      "common.back": "← Retour à la liste",
      "common.send": "Envoyer",
      "common.cancel": "Annuler",
      "common.close": "Fermer",
      "common.add": "+ Ajouter",
      "common.console": "Console",
      "common.cmdPh": "Commande",
      "common.noFolder": "Aucun dossier sélectionné",
      "server.launch": "▶ Lancer le serveur",
      "server.stop": "■ Arrêter le serveur",
      "server.forceStop": "⛔ Forcer l'arrêt",
      "mc.saveArgs": "💾 Enregistrer les arguments",
      "mc.saveProps": "💾 Enregistrer les propriétés",
      "mc.jvmTitle": "Arguments de lancement (JVM)",
      "mc.propsTitle": "Propriétés du serveur (server.properties)",
      "mc.cmdHint": "Le serveur doit être en cours d'exécution pour envoyer une commande.",
      "mc.cmdPh": "Commande (ex: say Bonjour, op Steve…)",
      "mc.empty": "Sélectionne le dossier contenant tes serveurs Minecraft pour commencer.",
      "ark.createBtn": "✨ Créer un serveur",
      "ark.createTitle": "✨ Créer un nouveau serveur Ark",
      "ark.folderName": "Nom du dossier du serveur",
      "ark.edition": "Édition",
      "ark.map": "Carte",
      "ark.customMap": "Carte personnalisée",
      "ark.session": "Nom de session",
      "ark.serverPw": "Mot de passe serveur",
      "ark.adminPw": "Mot de passe admin",
      "ark.maxPlayers": "Joueurs max",
      "ark.port": "Port",
      "ark.queryPort": "Query Port",
      "ark.difficulty": "Difficulté (0 à 1)",
      "ark.maxDino": "Niveau max des dinosaures sauvages",
      "ark.xp": "Multiplicateur XP",
      "ark.taming": "Multiplicateur domestication",
      "ark.harvest": "Multiplicateur récolte",
      "ark.pve": "Mode PvE (pas de combat JcJ)",
      "ark.createConfirm": "✨ Créer et lancer",
      "ark.setup": "🛠 Setup Ark Server",
      "ark.genScript": "📄 Générer un script .bat",
      "ark.mapSession": "Carte et session",
      "ark.saveLaunch": "💾 Enregistrer la configuration de lancement",
      "ark.commonSettings": "Paramètres serveur courants",
      "ark.saveCommon": "💾 Enregistrer ces paramètres",
      "ark.advanced": "Paramètres avancés (tous les réglages ServerSettings/SessionSettings)",
      "ark.saveAdvanced": "💾 Enregistrer les paramètres avancés",
      "ark.extraSession": "Paramètres de session additionnels (ex: RCONEnabled=True?RCONPort=27020)",
      "ark.extraFlags": "Arguments additionnels (ex: -server -log -NoBattlEye)",
      "ark.empty": "Sélectionne le dossier contenant tes serveurs Ark pour commencer.",
      "ark.phFolder": "ex: MonServeurArk",
      "ark.phCustomMap": "ex: MyModdedMap_WP",
      "ark.phNewKey": "Nouvelle clé (ex: bDisableStructurePlacementCollision)",
      "ark.phNewValue": "Valeur",
      "steamcmd.notInstalled": "SteamCMD n'est pas encore installé.",
      "steamcmd.download": "⬇ Télécharger SteamCMD",
      "steamcmd.launch": "▶ Lancer SteamCMD",
      "steamcmd.stop": "■ Arrêter",
      "steamcmd.reset": "🔄 Réinitialiser SteamCMD",
      "steamcmd.cmdPh": "Commande (ex: login anonymous)",
      "steamcmd.shortcuts": "Raccourcis (remplissent le champ, à toi de valider) :",
      "steamcmd.updAscended": "MAJ Ark Ascended (2430930)",
      "steamcmd.updEvolved": "MAJ Ark Evolved (376030)",
      "addgame.title": "Ajouter un jeu",
      "addgame.name": "Nom affiché :",
      "addgame.confirm": "Ajouter",
      "games.searching": "Recherche de vos jeux…",
      "games.empty": "Aucun jeu trouvé. Essayez « Resynchroniser » ou ajoutez un jeu manuellement.",
      "games.hotkeys": "↵ Lancer • ← → ↑ ↓ Naviguer • Échap Réduire • Manette compatible",
      "profiles.intro": "Profils du launcher Minecraft officiel. Installe un modpack via « Parcourir les modpacks » : les mods, le loader (Forge/NeoForge/Fabric) et un profil dédié (avec l'icône du modpack) sont créés automatiquement.",
      "profiles.empty": "Aucun profil trouvé dans le launcher Minecraft.",
      play: 'Jouer',
      folder: 'Dossier',
      uninstall: 'Désinstaller',
      'profiles.all': 'Tous',
      'profiles.modpack': 'Modpack',
      'profiles.vanilla': 'Vanilla',
      'profiles.other': 'Autre',
      'profiles.browse': '🧩 Parcourir les modpacks',
      'cf.title': '🧩 Modpacks CurseForge',
      'cf.close': '✕ Fermer',
      'cf.searchPh': 'Rechercher un modpack…',
      'cf.search': '🔍 Rechercher',
      'cf.empty': 'Aucun modpack trouvé.',
      'cf.loading': 'Chargement…',
      'cf.prev': '← Précédent',
      'cf.next': 'Suivant →',
      'cf.allTypes': 'Tous les types',
      'cf.types': 'Types',
      'cf.install': '⬇ Installer le modpack',
      'cf.installed': '✓ Déjà installé',
      'cf.serverpack': 'Serverpack',
      'cf.serverInstalled': '✓ Serveur installé',
      'cf.noServerpack': 'Pas de serverpack',
      'cf.versionsLoading': 'Chargement des versions…',
      'cf.versionsUnavailable': 'Versions indisponibles',
      'cf.pageWord': 'Page',
      'cf.modpacksWord': 'modpacks',
      'perf.cpu': 'Processeur (CPU)',
      'perf.ram': 'Mémoire (RAM)',
      'perf.gpu': 'Carte graphique (GPU)',
      'perf.proc': 'Processus les plus gourmands',
      'perf.disks': 'Disques',
      'perf.gpuEmpty': 'Aucune carte graphique détectée.',
      'perf.procEmpty': 'Aucun processus détecté.',
      'perf.disksEmpty': "Impossible de lire l'état des disques.",
      'perf.cores': 'cœurs (logiques)',
      'perf.ramUsed': 'utilisés sur',
      'perf.updated': 'Mis à jour à',

      // ---- Ajouts : chaînes précédemment codées en dur ----

      // Communs
      'common.remove': 'Retirer',
      'common.saved': 'Enregistré ✓',
      'common.deleteFailed': 'Échec de la suppression.',
      'common.errorLabel': 'Erreur :',
      'common.na': 'N/D',

      // Unités de taille
      'units.b': 'o',
      'units.kb': 'Ko',
      'units.mb': 'Mo',
      'units.gb': 'Go',

      // Onglet Jeux
      'games.optStandalone': 'Sans launcher',
      'games.optManual': 'Ajoutés manuellement',
      'games.lastSyncInit': 'Dernière synchronisation : —',
      'games.lastSyncLabel': 'Dernière synchronisation :',
      'games.never': 'jamais',
      'games.shortcutError': "Impossible de résoudre ce raccourci vers un exécutable valide.",
      'games.play': '▶ Jouer',
      'games.fetchArtwork': '🖼 Jaquette (SteamGridDB)',
      'games.resetArtwork': 'Réinitialiser la jaquette',
      'games.artworkSearching': 'Recherche de la jaquette…',
      'games.artworkDone': '✓ Jaquette appliquée',
      'games.artworkNoKey': 'Ajoute ta clé API SteamGridDB dans les Réglages.',
      'games.artworkNotFound': 'Aucune jaquette trouvée pour ce jeu.',
      'games.artworkError': 'Échec de la récupération de la jaquette.',
      'settings.artworkSection': 'Jaquettes (SteamGridDB)',
      'settings.sgdbKey': 'Clé API SteamGridDB',
      'settings.sgdbHint': 'Crée une clé API gratuite sur steamgriddb.com (Preferences → API). Ensuite, ouvre un jeu dans la ludothèque et clique « 🖼 Jaquette » pour récupérer une belle jaquette.',
      'settings.updateSection': 'Mise à jour',
      'settings.updateAutoCheck': 'Vérifier les mises à jour au démarrage',
      'settings.updateCurrent': 'Version actuelle :',
      'settings.updateCheck': 'Vérifier les mises à jour',
      'settings.updateDownload': 'Télécharger',
      'settings.updateInstall': 'Redémarrer et installer',
      'settings.updateHint': "L'hébergement du flux de mises à jour n'est pas encore branché : cette section devient active une fois la publication configurée côté build.",
      'update.checking': 'Recherche de mises à jour…',
      'update.available': 'Mise à jour disponible : version {version}.',
      'update.upToDate': "Vous avez déjà la dernière version.",
      'update.downloading': 'Téléchargement… {percent}%',
      'update.downloaded': 'Mise à jour {version} téléchargée. Prête à installer.',
      'update.error': 'Erreur de mise à jour : {detail}',
      'update.disabled': "Mises à jour indisponibles (flux non configuré).",
      'update.disabledDev': 'Mises à jour indisponibles en mode développement.',
      'platform.standalone': 'Sans launcher',
      'platform.manual': 'Ajouté manuellement',

      // Serveurs (communs Minecraft / Ark)
      'server.consoleEmpty': 'Aucune sortie pour le moment. Lance le serveur pour voir la console ici.',
      'server.launchErrorLabel': 'Erreur au lancement :',

      // Minecraft
      'mc.stopHint':
        "« Arrêter » envoie la commande <code>stop</code> (le serveur sauvegarde avant de quitter). « Forcer l'arrêt » tue immédiatement le script et Java — utile si la console reste bloquée en demandant d'appuyer sur Ctrl+C (un signal qu'on ne peut pas simuler via une commande texte).",
      'mc.scriptDetected': 'Script détecté : {script}',
      'mc.noScript': 'Aucun script .ps1/.bat détecté dans ce dossier.',
      'mc.jvmExists':
        'Fichier user_jvm_args.txt détecté : ces arguments seront utilisés si ton script le référence (java @user_jvm_args.txt -jar server.jar nogui).',
      'mc.jvmMissing':
        "Aucun user_jvm_args.txt pour l'instant : il sera créé à l'enregistrement. Assure-toi que ton script de lancement contient bien : java @user_jvm_args.txt -jar server.jar nogui",
      'mc.jvmUpdated':
        'Fichier user_jvm_args.txt mis à jour : ces arguments seront utilisés si ton script le référence (java @user_jvm_args.txt -jar server.jar nogui).',
      'mc.accessTitle': 'Accès (whitelist / ops / bans)',
      'mc.accessHint':
        'Serveur en cours : les modifications passent par la console (résolution du pseudo en ligne). Serveur arrêté : édition directe des fichiers (UUID récupéré via Mojang si possible).',
      'mc.whitelist': 'Whitelist',
      'mc.ops': 'Opérateurs',
      'mc.bans': 'Bannis',
      'mc.playerNamePh': 'Pseudo',
      'mc.banBtn': 'Bannir',
      'mc.accessEmpty': 'Aucun.',
      'mc.shareTitle': 'Partage (Hamachi)',
      'mc.shareHint': "Pour jouer avec des amis via Hamachi : rejoignez le même réseau Hamachi, puis partagez-leur l'adresse ci-dessous.",
      'mc.shareCopy': '📋 Copier',
      'mc.shareCopied': '✓ Copié',
      'mc.shareNoHamachi': "Aucun adaptateur Hamachi détecté. Installe et lance Hamachi, connecte-toi à un réseau, puis rafraîchis cette fiche.",
      'mc.playersTitle': 'Joueurs en ligne',
      'mc.playersOnline': '{count} en ligne',
      'mc.playersOffline': 'Serveur arrêté.',
      'mc.playersNone': 'Aucun joueur en ligne.',
      'mc.backupsTitle': 'Sauvegardes du monde',
      'mc.backupsHint': "Sauvegarde le(s) dossier(s) de monde dans « gg-backups ». Un serveur arrêté donne la sauvegarde la plus fiable ; en cours, les écritures sont figées le temps du zip.",
      'mc.backupCreate': '💾 Créer une sauvegarde',
      'mc.backupRestore': 'Restaurer',
      'mc.backupsEmpty': 'Aucune sauvegarde.',
      'mc.backupRestoreConfirm': 'Restaurer « {name} » ? Le monde actuel sera écrasé.',
      'mc.backupDeleteConfirm': 'Supprimer la sauvegarde « {name} » ?',
      'mc.backupCreating': 'Sauvegarde en cours…',
      'mc.backupDone': 'Sauvegarde créée ✓',
      'mc.backupRestored': 'Restauré ✓',
      'mc.noServers': 'Aucun serveur Minecraft détecté dans ce dossier.',
      'mc.metaScript': 'Script : {script}',
      'mc.metaNoScript': 'Aucun script détecté',
      'mc.propsFound': 'server.properties trouvé',
      'mc.propsAbsent': 'server.properties absent',
      'mc.confirmDelete':
        'Supprimer définitivement le serveur « {name} » ?\n\nLe dossier et tout son contenu seront supprimés. Action irréversible.',
      'mc.scriptLaunched': 'Script lancé : {script}',
      'mc.stopWarning':
        "⏳ Le serveur ne s'est pas encore arrêté après 25 secondes. S'il est bloqué (ex: demande d'appuyer sur Ctrl+C), tu peux utiliser « Forcer l'arrêt » ci-dessus — mais attention, les données non sauvegardées seront perdues.",
      'mc.forceStopConfirm':
        "Forcer l'arrêt va tuer immédiatement le serveur (script + Java), sans lui laisser le temps de sauvegarder. Continuer ?",

      // Ark — textes statiques (hints)
      'ark.createIntro':
        "Installe automatiquement un nouveau serveur dédié via SteamCMD, applique tes réglages, puis le lance. Nécessite que SteamCMD soit déjà téléchargé (onglet SteamCMD) et un dossier racine sélectionné.",
      'ark.maxDinoHint':
        "Le niveau maximum par défaut d'un serveur Ark officiel est 30. Réglé ici sur 150 (le standard le plus courant sur les serveurs communautaires), via le paramètre <code>OverrideOfficialDifficulty</code> calculé automatiquement (niveau max ≈ 30 × cette valeur).",
      'ark.steamcmdNote':
        "Note : SteamCMD n'affiche parfois aucune sortie pendant plusieurs minutes (il bufferise sa console quand elle n'est pas interactive) même quand le téléchargement avance normalement — fie-toi à l'indicateur de taille ci-dessus plutôt qu'à un écran vide.",
      'ark.setupHint':
        "<strong>« Setup Ark Server »</strong> applique en un clic la carte/session ci-dessous et les paramètres serveur courants, puis lance directement — pratique pour un serveur déjà installé, sans repasser par SteamCMD.",
      'ark.stopHint':
        "« Arrêter » ferme le processus. « Forcer l'arrêt » tue immédiatement tout l'arbre de processus (script + serveur) — utile si la console reste bloquée en demandant d'appuyer sur Ctrl+C (un signal qu'on ne peut pas simuler via une commande texte). Attention : un arrêt forcé ne laisse pas au serveur le temps de sauvegarder proprement.",
      'ark.consoleHint':
        "Les commandes sont envoyées via RCON (le vrai canal d'administration Ark). Nécessite RCON activé (ci-dessous), un mot de passe admin défini, et le serveur en cours d'exécution.",
      'ark.consoleRcon': 'Console (RCON)',
      'ark.rconCmdPh': 'Commande RCON (ex: Broadcast Bonjour)',
      'ark.rconEnabled': 'Activer RCON (console / joueurs à distance)',
      'ark.rconPort': 'Port RCON',
      'ark.saveWorld': '💾 Sauvegarder le monde',
      'ark.broadcast': '📢 Message à tous',
      'ark.players': 'Joueurs connectés',
      'ark.refreshPlayers': '⟳ Rafraîchir la liste',
      'ark.playersHint': 'Nécessite RCON (activé ci-dessous) et un serveur en cours d\'exécution.',
      'ark.noPlayers': 'Aucun joueur connecté.',
      'ark.kick': 'Expulser',
      'ark.ban': 'Bannir',
      'ark.banConfirm': 'Bannir définitivement « {name} » de ce serveur ?',
      'ark.defaultSession': 'Mon Serveur Ark',

      // Ark — dynamique
      'ark.customMapOption': 'Autre (carte personnalisée / moddée)…',
      'ark.noAdvancedParams': 'Aucun paramètre trouvé dans [ServerSettings].',
      'ark.exeDetected': 'Exécutable détecté : {name} ({edition})',
      'ark.editionUnknown': 'édition inconnue',
      'ark.noExe': "Aucun exécutable serveur trouvé dans ShooterGame\\Binaries\\Win64.",
      'ark.noServers': "Aucun serveur Ark détecté dans ce dossier (recherche d'un sous-dossier \"ShooterGame\").",
      'ark.exeFound': 'Exécutable trouvé',
      'ark.exeNotFound': 'Exécutable introuvable',
      'ark.configFound': 'Configuration trouvée',
      'ark.configAbsent': 'Configuration absente',
      'ark.autoDetecting':
        'Recherche automatique de ton installation Ark en cours… (peut prendre quelques instants au premier lancement)',
      'ark.confirmDelete':
        'Supprimer définitivement le serveur Ark « {name} » ?\n\nLe dossier et tout son contenu seront supprimés. Action irréversible.',
      'ark.applyingConfig': 'Application de la configuration…',
      'ark.setupLaunchFail': 'Configuration appliquée, mais échec au lancement : {error}',
      'ark.setupLaunchOk': 'Configuration appliquée et serveur lancé — carte : {map}',
      'ark.launching': 'Lancement en cours — carte : {map}',
      'ark.stopWarning':
        "⏳ Le serveur ne s'est pas encore arrêté après 25 secondes. Tu peux utiliser « Forcer l'arrêt » ci-dessus si nécessaire — mais attention, les données non sauvegardées seront perdues.",
      'ark.forceStopConfirm':
        "Forcer l'arrêt va tuer immédiatement le serveur, sans lui laisser le temps de sauvegarder. Continuer ?",
      'ark.scriptGenerated': 'Script généré : {name}',
      'ark.installProgress': "📦 Progression détectée : {count} fichiers, {size} téléchargés jusqu'à présent.",
      'ark.installWaiting': '📦 En attente des premiers fichiers (le téléchargement démarre)…',
      'ark.needRootFolder': "Choisis d'abord un dossier racine pour tes serveurs Ark (bouton \"Choisir le dossier\").",
      'ark.needFolderName': 'Indique un nom de dossier pour ce serveur.',
      'ark.needMap': 'Indique une carte.',
      'ark.installing':
        "Installation via SteamCMD en cours… (peut prendre plusieurs minutes selon ta connexion, ne ferme pas l'appli)",
      'ark.createSuccess': '✅ Serveur créé et lancé avec succès !',
      'ark.createFailStep': "❌ Échec à l'étape « {step} »",
      'ark.settingPlaceholder': '(non défini)',

      // Ark — libellés des paramètres serveur courants
      'arkcs.pve': 'Mode PvE (pas de combat JcJ)',
      'arkcs.hardcore': 'Mode Hardcore',
      'arkcs.thirdPerson': 'Vue à la troisième personne autorisée',
      'arkcs.difficulty': 'Difficulté (0 à 1)',
      'arkcs.override': 'Niveau max dinos sauvages ÷ 30 (5 = niveau 150)',
      'arkcs.xp': 'Multiplicateur XP',
      'arkcs.taming': 'Multiplicateur vitesse de domestication',
      'arkcs.harvest': 'Multiplicateur ressources récoltées',
      'arkcs.dayCycle': 'Vitesse du cycle jour/nuit',

      // SteamCMD
      'steamcmd.desc':
        'Outil en ligne de commande officiel de Valve, pratique pour installer ou mettre à jour un serveur dédié Ark (ou tout autre jeu) sans passer par le client Steam complet.',
      'steamcmd.resetHint':
        "En cas d'erreur du type <em>« didn't shutdown cleanly »</em> ou <em>« missing configuration »</em> lors d'une installation, les fichiers internes de SteamCMD sont probablement corrompus (souvent après un arrêt brutal). « Réinitialiser SteamCMD » supprime tout et permet de retélécharger une copie propre.",
      'steamcmd.consoleEmpty': 'Aucune sortie pour le moment. Lance SteamCMD pour voir la console ici.',
      'steamcmd.downloading': 'Téléchargement et extraction en cours (quelques instants)…',
      'steamcmd.resetConfirm':
        "Ça va supprimer entièrement SteamCMD (il faudra le retélécharger). Utile en cas d'erreur \"didn't shutdown cleanly\" ou \"missing configuration\" lors d'une installation. Continuer ?",
      'steamcmd.resetFailedLabel': 'Échec de la réinitialisation :',
      'steamcmd.forceStopConfirm': "Forcer l'arrêt va tuer immédiatement SteamCMD. Continuer ?",

      // CurseForge — dynamique
      'cf.searchFailed': 'Échec de la recherche.',
      'cf.serverInstalledTitle': 'Un serveur pour ce modpack est déjà installé dans ton dossier.',
      'cf.noServerpackTitle': 'Cette version ne fournit pas de serverpack.',
      'cf.installedSuffix': ' ✓ installé',
      'cf.prepInstall': "Préparation de l'installation : {name}…",
      'cf.installFailed': "Échec de l'installation.",
      'cf.javaRequired': ' (Java requis pour Forge/NeoForge.)',
      'cf.profileCreated': '✓ Profil « {name} » créé dans le launcher Minecraft (MC {mc}, {loader}).',
      'cf.modsFailed':
        " ⚠ {failed}/{total} mod(s) non téléchargé(s) (distribution désactivée par l'auteur — à ajouter manuellement).",
      'cf.dlServerpack': 'Téléchargement du serverpack : {name}…',
      'cf.serverpackFailed': 'Échec du téléchargement du serverpack.',
      'cf.serverpackDone': '✓ Serverpack « {name} » téléchargé dans ton dossier de serveurs.',
      'cf.phaseResolving': 'Résolution du lien de téléchargement…',
      'cf.phaseDownloading': 'Téléchargement… {pct}% ({received} / {total})',
      'cf.phaseDownloadingSimple': 'Téléchargement… {received}',
      'cf.phaseExtracting': "Extraction de l'archive…",
      'cf.phaseOverrides': 'Copie des fichiers de configuration (overrides)…',
      'cf.phaseMods': 'Téléchargement des mods… {received}/{total}',
      'cf.phaseLoader': 'Installation du loader ({loader})…',
      'cf.phaseIcon': "Préparation de l'icône du profil…",
      'cf.phaseProfile': 'Création du profil dans le launcher…',

      // Profils Minecraft — dynamique
      'profiles.launchFailed': 'Impossible de lancer ce profil.',
      'profiles.uninstallConfirm1':
        'Désinstaller le modpack « {name} » ?\n\nCela retire le profil du launcher et supprime son dossier de jeu',
      'profiles.uninstallConfirmEnd': '\n\nCette action est irréversible.',
      'profiles.uninstallFailed': 'Échec de la désinstallation.',
      'profiles.readFailed': 'Impossible de lire les profils du launcher.',
      'profiles.minecraftMissing':
        '⚠ Dossier .minecraft introuvable ({dir}). Installe et lance le launcher Minecraft officiel au moins une fois.',
      'quickLaunch': '⚡ Lancement rapide',
      'profiles.quickLaunchTitle': 'Lancement direct hors-ligne (sans le launcher officiel)',
      'profiles.quickLaunching': '⚡ Lancement hors-ligne de « {name} » ({player})…',
      'profiles.quickLaunchUnavailable': 'Redémarre complètement G-GameManager (via l\'icône de la zone de notification → Quitter) pour activer le lancement rapide.',
    },
    en: {
      'tab.games': '🎮 Games',
      'tab.minecraft': 'Minecraft Servers',
      'tab.minecraftGroup': 'Minecraft',
      'tab.mcprofiles': 'Minecraft Profiles',
      'tab.ark': 'ARK Survival',
      'tab.steamcmd': 'SteamCMD',
      'tab.performance': 'Performance',
      'tab.dashboard': '🖥️ Dashboard',
      'dash.empty': 'No server detected. Set up your servers in the Minecraft, Ark or SteamCMD tabs.',
      'dash.running': 'Running',
      'dash.starting': 'Starting…',
      'dash.stopped': 'Stopped',
      'dash.error': 'Error',
      'dash.ram': 'RAM:',
      'dash.cpu': 'CPU:',
      'dash.start': '▶ Start',
      'dash.stop': '■ Stop',
      'dash.force': '⛔ Force',
      'dash.forceTitle': 'Force stop (kills the whole process tree)',
      'dash.forceConfirm': 'Force stop "{name}"? Unsaved data may be lost.',
      'dash.open': 'Open',
      'dash.autostart': 'Auto-start',
      'dash.autorestart': 'Auto-restart on crash',
      'dash.restartEvery': 'Restart every',
      'dash.hoursUnit': 'h',
      'dash.updated': 'Updated at',
      'dash.serversTitle': 'Servers',
      'dash.filterAll': 'All',
      'defaultProfile': 'Default profile',
      'settings.title': 'Settings',
      'settings.theme': 'Theme',
      'settings.light': 'Light',
      'settings.dark': 'Dark',
      'settings.language': 'Language',
      'settings.gamesSection': 'Games',
      'settings.startup': 'Launch on Windows startup',
      'settings.standalone': 'Detect games installed without a launcher (experimental)',
      'settings.standaloneHint':
        'Finds games installed directly (without Steam/Epic/etc.) via the Windows registry. Best-effort: may include some software that is not a game. Disabled by default. Requires a resync to take effect.',
      'settings.manualGames': 'Manually added games',
      'settings.manualHint':
        'Tip: if a game (notably Riot Games or Battle.net) is not detected automatically, add it manually via "+ Add a game".',
      'common.refresh': '⟳ Refresh',
      'games.platform': 'Platform:',
      'games.allGames': 'All games',
      'games.searchLabel': 'Search:',
      'games.searchPh': 'Game name…',
      'games.resync': '⟳ Resync',
      'games.addGame': '+ Add a game',
      'server.delete': '🗑 Delete server',
      "common.chooseFolder": "📁 Choose folder",
      "common.back": "← Back to list",
      "common.send": "Send",
      "common.cancel": "Cancel",
      "common.close": "Close",
      "common.add": "+ Add",
      "common.console": "Console",
      "common.cmdPh": "Command",
      "common.noFolder": "No folder selected",
      "server.launch": "▶ Start server",
      "server.stop": "■ Stop server",
      "server.forceStop": "⛔ Force stop",
      "mc.saveArgs": "💾 Save arguments",
      "mc.saveProps": "💾 Save properties",
      "mc.jvmTitle": "Launch arguments (JVM)",
      "mc.propsTitle": "Server properties (server.properties)",
      "mc.cmdHint": "The server must be running to send a command.",
      "mc.cmdPh": "Command (e.g. say Hello, op Steve…)",
      "mc.empty": "Select the folder containing your Minecraft servers to begin.",
      "ark.createBtn": "✨ Create a server",
      "ark.createTitle": "✨ Create a new Ark server",
      "ark.folderName": "Server folder name",
      "ark.edition": "Edition",
      "ark.map": "Map",
      "ark.customMap": "Custom map",
      "ark.session": "Session name",
      "ark.serverPw": "Server password",
      "ark.adminPw": "Admin password",
      "ark.maxPlayers": "Max players",
      "ark.port": "Port",
      "ark.queryPort": "Query port",
      "ark.difficulty": "Difficulty (0 to 1)",
      "ark.maxDino": "Max wild dino level",
      "ark.xp": "XP multiplier",
      "ark.taming": "Taming multiplier",
      "ark.harvest": "Harvest multiplier",
      "ark.pve": "PvE mode (no PvP)",
      "ark.createConfirm": "✨ Create and launch",
      "ark.setup": "🛠 Setup Ark Server",
      "ark.genScript": "📄 Generate a .bat script",
      "ark.mapSession": "Map and session",
      "ark.saveLaunch": "💾 Save launch configuration",
      "ark.commonSettings": "Common server settings",
      "ark.saveCommon": "💾 Save these settings",
      "ark.advanced": "Advanced settings (all ServerSettings/SessionSettings)",
      "ark.saveAdvanced": "💾 Save advanced settings",
      "ark.extraSession": "Additional session parameters (e.g. RCONEnabled=True?RCONPort=27020)",
      "ark.extraFlags": "Additional arguments (e.g. -server -log -NoBattlEye)",
      "ark.empty": "Select the folder containing your Ark servers to begin.",
      "ark.phFolder": "e.g. MyArkServer",
      "ark.phCustomMap": "e.g. MyModdedMap_WP",
      "ark.phNewKey": "New key (e.g. bDisableStructurePlacementCollision)",
      "ark.phNewValue": "Value",
      "steamcmd.notInstalled": "SteamCMD is not installed yet.",
      "steamcmd.download": "⬇ Download SteamCMD",
      "steamcmd.launch": "▶ Launch SteamCMD",
      "steamcmd.stop": "■ Stop",
      "steamcmd.reset": "🔄 Reset SteamCMD",
      "steamcmd.cmdPh": "Command (e.g. login anonymous)",
      "steamcmd.shortcuts": "Shortcuts (fill the field, you confirm):",
      "steamcmd.updAscended": "Update Ark Ascended (2430930)",
      "steamcmd.updEvolved": "Update Ark Evolved (376030)",
      "addgame.title": "Add a game",
      "addgame.name": "Display name:",
      "addgame.confirm": "Add",
      "games.searching": "Searching for your games…",
      "games.empty": "No game found. Try \"Resync\" or add a game manually.",
      "games.hotkeys": "↵ Launch • ← → ↑ ↓ Navigate • Esc Minimize • Controller supported",
      "profiles.intro": "Profiles from the official Minecraft launcher. Install a modpack via \"Browse modpacks\": the mods, the loader (Forge/NeoForge/Fabric) and a dedicated profile (with the modpack icon) are created automatically.",
      "profiles.empty": "No profile found in the Minecraft launcher.",
      play: 'Play',
      folder: 'Folder',
      uninstall: 'Uninstall',
      'profiles.all': 'All',
      'profiles.modpack': 'Modpack',
      'profiles.vanilla': 'Vanilla',
      'profiles.other': 'Other',
      'profiles.browse': '🧩 Browse modpacks',
      'cf.title': '🧩 CurseForge Modpacks',
      'cf.close': '✕ Close',
      'cf.searchPh': 'Search a modpack…',
      'cf.search': '🔍 Search',
      'cf.empty': 'No modpack found.',
      'cf.loading': 'Loading…',
      'cf.prev': '← Previous',
      'cf.next': 'Next →',
      'cf.allTypes': 'All types',
      'cf.types': 'Types',
      'cf.install': '⬇ Install modpack',
      'cf.installed': '✓ Already installed',
      'cf.serverpack': 'Serverpack',
      'cf.serverInstalled': '✓ Server installed',
      'cf.noServerpack': 'No serverpack',
      'cf.versionsLoading': 'Loading versions…',
      'cf.versionsUnavailable': 'Versions unavailable',
      'cf.pageWord': 'Page',
      'cf.modpacksWord': 'modpacks',
      'perf.cpu': 'Processor (CPU)',
      'perf.ram': 'Memory (RAM)',
      'perf.gpu': 'Graphics card (GPU)',
      'perf.proc': 'Top processes',
      'perf.disks': 'Disks',
      'perf.gpuEmpty': 'No graphics card detected.',
      'perf.procEmpty': 'No process detected.',
      'perf.disksEmpty': 'Unable to read disk status.',
      'perf.cores': 'cores (logical)',
      'perf.ramUsed': 'used of',
      'perf.updated': 'Updated at',

      // ---- Additions: strings previously hard-coded ----

      // Common
      'common.remove': 'Remove',
      'common.saved': 'Saved ✓',
      'common.deleteFailed': 'Deletion failed.',
      'common.errorLabel': 'Error:',
      'common.na': 'N/A',

      // Size units
      'units.b': 'B',
      'units.kb': 'KB',
      'units.mb': 'MB',
      'units.gb': 'GB',

      // Games tab
      'games.optStandalone': 'No launcher',
      'games.optManual': 'Manually added',
      'games.lastSyncInit': 'Last sync: —',
      'games.lastSyncLabel': 'Last sync:',
      'games.never': 'never',
      'games.shortcutError': 'Unable to resolve this shortcut to a valid executable.',
      'games.play': '▶ Play',
      'games.fetchArtwork': '🖼 Artwork (SteamGridDB)',
      'games.resetArtwork': 'Reset artwork',
      'games.artworkSearching': 'Searching artwork…',
      'games.artworkDone': '✓ Artwork applied',
      'games.artworkNoKey': 'Add your SteamGridDB API key in Settings.',
      'games.artworkNotFound': 'No artwork found for this game.',
      'games.artworkError': 'Failed to fetch artwork.',
      'settings.artworkSection': 'Artwork (SteamGridDB)',
      'settings.sgdbKey': 'SteamGridDB API key',
      'settings.sgdbHint': 'Create a free API key on steamgriddb.com (Preferences → API). Then open a game in your library and click "🖼 Artwork" to fetch a nice cover.',
      'settings.updateSection': 'Updates',
      'settings.updateAutoCheck': 'Check for updates on startup',
      'settings.updateCurrent': 'Current version:',
      'settings.updateCheck': 'Check for updates',
      'settings.updateDownload': 'Download',
      'settings.updateInstall': 'Restart and install',
      'settings.updateHint': 'The update feed hosting is not wired up yet: this section becomes active once publishing is configured on the build side.',
      'update.checking': 'Checking for updates…',
      'update.available': 'Update available: version {version}.',
      'update.upToDate': 'You already have the latest version.',
      'update.downloading': 'Downloading… {percent}%',
      'update.downloaded': 'Update {version} downloaded. Ready to install.',
      'update.error': 'Update error: {detail}',
      'update.disabled': 'Updates unavailable (feed not configured).',
      'update.disabledDev': 'Updates unavailable in development mode.',
      'platform.standalone': 'No launcher',
      'platform.manual': 'Manually added',

      // Servers (shared Minecraft / Ark)
      'server.consoleEmpty': 'No output yet. Start the server to see the console here.',
      'server.launchErrorLabel': 'Launch error:',

      // Minecraft
      'mc.stopHint':
        '"Stop" sends the <code>stop</code> command (the server saves before quitting). "Force stop" immediately kills the script and Java — useful if the console is stuck asking you to press Ctrl+C (a signal that cannot be simulated through a text command).',
      'mc.scriptDetected': 'Script detected: {script}',
      'mc.noScript': 'No .ps1/.bat script detected in this folder.',
      'mc.jvmExists':
        'user_jvm_args.txt file detected: these arguments will be used if your script references it (java @user_jvm_args.txt -jar server.jar nogui).',
      'mc.jvmMissing':
        'No user_jvm_args.txt yet: it will be created on save. Make sure your launch script contains: java @user_jvm_args.txt -jar server.jar nogui',
      'mc.jvmUpdated':
        'user_jvm_args.txt file updated: these arguments will be used if your script references it (java @user_jvm_args.txt -jar server.jar nogui).',
      'mc.accessTitle': 'Access (whitelist / ops / bans)',
      'mc.accessHint':
        'Server running: changes go through the console (online name resolution). Server stopped: files are edited directly (UUID fetched via Mojang when possible).',
      'mc.whitelist': 'Whitelist',
      'mc.ops': 'Operators',
      'mc.bans': 'Banned',
      'mc.playerNamePh': 'Player name',
      'mc.banBtn': 'Ban',
      'mc.accessEmpty': 'None.',
      'mc.shareTitle': 'Sharing (Hamachi)',
      'mc.shareHint': 'To play with friends via Hamachi: join the same Hamachi network, then share the address below with them.',
      'mc.shareCopy': '📋 Copy',
      'mc.shareCopied': '✓ Copied',
      'mc.shareNoHamachi': 'No Hamachi adapter detected. Install and start Hamachi, join a network, then refresh this page.',
      'mc.playersTitle': 'Online players',
      'mc.playersOnline': '{count} online',
      'mc.playersOffline': 'Server stopped.',
      'mc.playersNone': 'No players online.',
      'mc.backupsTitle': 'World backups',
      'mc.backupsHint': 'Backs up the world folder(s) into "gg-backups". A stopped server gives the most reliable backup; while running, writes are frozen during the zip.',
      'mc.backupCreate': '💾 Create a backup',
      'mc.backupRestore': 'Restore',
      'mc.backupsEmpty': 'No backup yet.',
      'mc.backupRestoreConfirm': 'Restore "{name}"? The current world will be overwritten.',
      'mc.backupDeleteConfirm': 'Delete the backup "{name}"?',
      'mc.backupCreating': 'Backing up…',
      'mc.backupDone': 'Backup created ✓',
      'mc.backupRestored': 'Restored ✓',
      'mc.noServers': 'No Minecraft server detected in this folder.',
      'mc.metaScript': 'Script: {script}',
      'mc.metaNoScript': 'No script detected',
      'mc.propsFound': 'server.properties found',
      'mc.propsAbsent': 'server.properties missing',
      'mc.confirmDelete':
        'Permanently delete the server "{name}"?\n\nThe folder and all its contents will be deleted. This cannot be undone.',
      'mc.scriptLaunched': 'Script launched: {script}',
      'mc.stopWarning':
        '⏳ The server has not stopped yet after 25 seconds. If it is stuck (e.g. asking to press Ctrl+C), you can use "Force stop" above — but beware, any unsaved data will be lost.',
      'mc.forceStopConfirm':
        'Force stop will immediately kill the server (script + Java), without giving it time to save. Continue?',

      // Ark — static hints
      'ark.createIntro':
        'Automatically installs a new dedicated server via SteamCMD, applies your settings, then launches it. Requires SteamCMD to be already downloaded (SteamCMD tab) and a root folder selected.',
      'ark.maxDinoHint':
        'The default maximum level on an official Ark server is 30. Set here to 150 (the most common standard on community servers), via the <code>OverrideOfficialDifficulty</code> parameter computed automatically (max level ≈ 30 × this value).',
      'ark.steamcmdNote':
        'Note: SteamCMD sometimes shows no output for several minutes (it buffers its console when not interactive) even when the download is progressing normally — rely on the size indicator above rather than a blank screen.',
      'ark.setupHint':
        '<strong>"Setup Ark Server"</strong> applies the map/session below and the current server settings in one click, then launches directly — handy for an already-installed server, without going back through SteamCMD.',
      'ark.stopHint':
        '"Stop" closes the process. "Force stop" immediately kills the whole process tree (script + server) — useful if the console is stuck asking to press Ctrl+C (a signal that cannot be simulated through a text command). Warning: a forced stop does not give the server time to save properly.',
      'ark.consoleHint':
        'Commands are sent via RCON (Ark\'s real administration channel). Requires RCON enabled (below), an admin password set, and the server running.',
      'ark.consoleRcon': 'Console (RCON)',
      'ark.rconCmdPh': 'RCON command (e.g. Broadcast Hello)',
      'ark.rconEnabled': 'Enable RCON (remote console / players)',
      'ark.rconPort': 'RCON port',
      'ark.saveWorld': '💾 Save world',
      'ark.broadcast': '📢 Broadcast',
      'ark.players': 'Connected players',
      'ark.refreshPlayers': '⟳ Refresh list',
      'ark.playersHint': 'Requires RCON (enabled below) and the server running.',
      'ark.noPlayers': 'No players connected.',
      'ark.kick': 'Kick',
      'ark.ban': 'Ban',
      'ark.banConfirm': 'Permanently ban "{name}" from this server?',
      'ark.defaultSession': 'My Ark Server',

      // Ark — dynamic
      'ark.customMapOption': 'Other (custom / modded map)…',
      'ark.noAdvancedParams': 'No setting found in [ServerSettings].',
      'ark.exeDetected': 'Executable detected: {name} ({edition})',
      'ark.editionUnknown': 'unknown edition',
      'ark.noExe': 'No server executable found in ShooterGame\\Binaries\\Win64.',
      'ark.noServers': 'No Ark server detected in this folder (looking for a "ShooterGame" subfolder).',
      'ark.exeFound': 'Executable found',
      'ark.exeNotFound': 'Executable not found',
      'ark.configFound': 'Configuration found',
      'ark.configAbsent': 'Configuration missing',
      'ark.autoDetecting':
        'Automatically searching for your Ark installation… (may take a moment on first launch)',
      'ark.confirmDelete':
        'Permanently delete the Ark server "{name}"?\n\nThe folder and all its contents will be deleted. This cannot be undone.',
      'ark.applyingConfig': 'Applying configuration…',
      'ark.setupLaunchFail': 'Configuration applied, but launch failed: {error}',
      'ark.setupLaunchOk': 'Configuration applied and server launched — map: {map}',
      'ark.launching': 'Launching — map: {map}',
      'ark.stopWarning':
        '⏳ The server has not stopped yet after 25 seconds. You can use "Force stop" above if needed — but beware, any unsaved data will be lost.',
      'ark.forceStopConfirm':
        'Force stop will immediately kill the server, without giving it time to save. Continue?',
      'ark.scriptGenerated': 'Script generated: {name}',
      'ark.installProgress': '📦 Progress detected: {count} files, {size} downloaded so far.',
      'ark.installWaiting': '📦 Waiting for the first files (download starting)…',
      'ark.needRootFolder': 'First choose a root folder for your Ark servers ("Choose folder" button).',
      'ark.needFolderName': 'Enter a folder name for this server.',
      'ark.needMap': 'Enter a map.',
      'ark.installing':
        'Installing via SteamCMD… (may take several minutes depending on your connection, do not close the app)',
      'ark.createSuccess': '✅ Server created and launched successfully!',
      'ark.createFailStep': '❌ Failed at step "{step}"',
      'ark.settingPlaceholder': '(not set)',

      // Ark — common server settings labels
      'arkcs.pve': 'PvE mode (no PvP)',
      'arkcs.hardcore': 'Hardcore mode',
      'arkcs.thirdPerson': 'Third-person view allowed',
      'arkcs.difficulty': 'Difficulty (0 to 1)',
      'arkcs.override': 'Max wild dino level ÷ 30 (5 = level 150)',
      'arkcs.xp': 'XP multiplier',
      'arkcs.taming': 'Taming speed multiplier',
      'arkcs.harvest': 'Harvested resources multiplier',
      'arkcs.dayCycle': 'Day/night cycle speed',

      // SteamCMD
      'steamcmd.desc':
        "Valve's official command-line tool, handy for installing or updating an Ark dedicated server (or any other game) without going through the full Steam client.",
      'steamcmd.resetHint':
        'On an error like <em>"didn\'t shutdown cleanly"</em> or <em>"missing configuration"</em> during an installation, SteamCMD\'s internal files are probably corrupted (often after an abrupt stop). "Reset SteamCMD" deletes everything and lets you re-download a clean copy.',
      'steamcmd.consoleEmpty': 'No output yet. Launch SteamCMD to see the console here.',
      'steamcmd.downloading': 'Downloading and extracting (a few moments)…',
      'steamcmd.resetConfirm':
        'This will completely delete SteamCMD (you will need to re-download it). Useful on a "didn\'t shutdown cleanly" or "missing configuration" error during an installation. Continue?',
      'steamcmd.resetFailedLabel': 'Reset failed:',
      'steamcmd.forceStopConfirm': 'Force stop will immediately kill SteamCMD. Continue?',

      // CurseForge — dynamic
      'cf.searchFailed': 'Search failed.',
      'cf.serverInstalledTitle': 'A server for this modpack is already installed in your folder.',
      'cf.noServerpackTitle': 'This version does not provide a serverpack.',
      'cf.installedSuffix': ' ✓ installed',
      'cf.prepInstall': 'Preparing installation: {name}…',
      'cf.installFailed': 'Installation failed.',
      'cf.javaRequired': ' (Java required for Forge/NeoForge.)',
      'cf.profileCreated': '✓ Profile "{name}" created in the Minecraft launcher (MC {mc}, {loader}).',
      'cf.modsFailed':
        ' ⚠ {failed}/{total} mod(s) not downloaded (distribution disabled by the author — to be added manually).',
      'cf.dlServerpack': 'Downloading serverpack: {name}…',
      'cf.serverpackFailed': 'Serverpack download failed.',
      'cf.serverpackDone': '✓ Serverpack "{name}" downloaded to your servers folder.',
      'cf.phaseResolving': 'Resolving download link…',
      'cf.phaseDownloading': 'Downloading… {pct}% ({received} / {total})',
      'cf.phaseDownloadingSimple': 'Downloading… {received}',
      'cf.phaseExtracting': 'Extracting archive…',
      'cf.phaseOverrides': 'Copying configuration files (overrides)…',
      'cf.phaseMods': 'Downloading mods… {received}/{total}',
      'cf.phaseLoader': 'Installing loader ({loader})…',
      'cf.phaseIcon': 'Preparing profile icon…',
      'cf.phaseProfile': 'Creating profile in the launcher…',

      // Minecraft profiles — dynamic
      'profiles.launchFailed': 'Unable to launch this profile.',
      'profiles.uninstallConfirm1':
        'Uninstall the modpack "{name}"?\n\nThis removes the profile from the launcher and deletes its game folder',
      'profiles.uninstallConfirmEnd': '\n\nThis action is irreversible.',
      'profiles.uninstallFailed': 'Uninstall failed.',
      'profiles.readFailed': 'Unable to read the launcher profiles.',
      'profiles.minecraftMissing':
        '⚠ .minecraft folder not found ({dir}). Install and run the official Minecraft launcher at least once.',
      'quickLaunch': '⚡ Quick Launch',
      'profiles.quickLaunchTitle': 'Direct offline launch (without the official launcher)',
      'profiles.quickLaunching': '⚡ Launching "{name}" offline ({player})…',
      'profiles.quickLaunchUnavailable': 'Fully restart G-GameManager (via the tray icon → Quit) to enable quick launch.',
    },
  };

  // Interpolation simple : remplace {clé} par params.clé.
  function interpolate(str, params) {
    if (!params || typeof str !== 'string') return str;
    return str.replace(/\{(\w+)\}/g, (m, k) => (params[k] != null ? params[k] : m));
  }

  function t(key, l, params) {
    const table = I18N[l] || I18N.fr;
    const value = Object.prototype.hasOwnProperty.call(table, key) ? table[key] : null;
    if (value == null) return null;
    return interpolate(value, params);
  }

  function translateDom(l) {
    document.querySelectorAll('[data-i18n]').forEach((elm) => {
      const v = t(elm.getAttribute('data-i18n'), l);
      if (v != null) elm.textContent = v;
    });
    document.querySelectorAll('[data-i18n-html]').forEach((elm) => {
      const v = t(elm.getAttribute('data-i18n-html'), l);
      if (v != null) elm.innerHTML = v;
    });
    document.querySelectorAll('[data-i18n-ph]').forEach((elm) => {
      const v = t(elm.getAttribute('data-i18n-ph'), l);
      if (v != null) elm.setAttribute('placeholder', v);
    });
    document.querySelectorAll('[data-i18n-title]').forEach((elm) => {
      const v = t(elm.getAttribute('data-i18n-title'), l);
      if (v != null) elm.setAttribute('title', v);
    });
    // Valeur par défaut d'un champ (uniquement s'il n'a pas déjà été modifié) :
    // sert aux valeurs pré-remplies traduisibles (ex: « Mon Serveur Ark »).
    document.querySelectorAll('[data-i18n-value]').forEach((elm) => {
      const v = t(elm.getAttribute('data-i18n-value'), l);
      if (v != null && (!elm.dataset.i18nDirty || elm.dataset.i18nDirty !== 'true')) {
        elm.value = v;
      }
    });
  }

  function updateSegActive() {
    document.querySelectorAll('#themeSeg [data-theme-choice]').forEach((b) => {
      b.classList.toggle('active', b.getAttribute('data-theme-choice') === theme);
    });
    document.querySelectorAll('#langSeg [data-lang-choice]').forEach((b) => {
      b.classList.toggle('active', b.getAttribute('data-lang-choice') === lang);
    });
  }

  function applyTheme(next) {
    theme = next === 'light' ? 'light' : 'dark';
    root.dataset.theme = theme;
    writeStore(STORE_THEME, theme);
    updateSegActive();
  }

  // Prévient le processus principal (tray, boîtes de dialogue, messages backend)
  // de la langue courante, best-effort.
  function notifyMainLang(l) {
    try {
      if (window.api && typeof window.api.setLang === 'function') window.api.setLang(l);
    } catch (e) {
      /* ignore */
    }
  }

  function applyLang(next) {
    lang = next === 'en' ? 'en' : 'fr';
    root.dataset.lang = lang;
    document.documentElement.setAttribute('lang', lang);
    writeStore(STORE_LANG, lang);
    translateDom(lang);
    updateSegActive();
    notifyMainLang(lang);
    // Prévient les panneaux qui construisent leur contenu dynamiquement (CurseForge,
    // Performance, Profils, Minecraft, Ark, SteamCMD) pour qu'ils retraduisent leurs libellés.
    try {
      document.dispatchEvent(new CustomEvent('gg-langchange', { detail: { lang } }));
    } catch (e) {
      /* ignore */
    }
  }

  function onReady() {
    const modal = document.getElementById('appSettingsModal');
    const openBtn = document.getElementById('appSettingsBtn');
    const closeBtn = document.getElementById('appSettingsCloseBtn');

    if (openBtn && modal) {
      openBtn.addEventListener('click', () => {
        modal.style.display = 'flex';
        // Rafraîchit la liste des jeux ajoutés manuellement (gérée par renderer.js).
        if (window.GamesSettings && typeof window.GamesSettings.refresh === 'function') {
          window.GamesSettings.refresh();
        }
      });
    }
    if (closeBtn && modal) {
      closeBtn.addEventListener('click', () => { modal.style.display = 'none'; });
    }
    if (modal) {
      modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });
    }

    document.querySelectorAll('#themeSeg [data-theme-choice]').forEach((b) => {
      b.addEventListener('click', () => applyTheme(b.getAttribute('data-theme-choice')));
    });
    document.querySelectorAll('#langSeg [data-lang-choice]').forEach((b) => {
      b.addEventListener('click', () => applyLang(b.getAttribute('data-lang-choice')));
    });

    // Marque un champ à valeur traduisible comme « modifié » dès que l'utilisateur
    // y touche, pour ne pas écraser sa saisie lors d'un changement de langue.
    document.querySelectorAll('[data-i18n-value]').forEach((elm) => {
      elm.addEventListener('input', () => { elm.dataset.i18nDirty = 'true'; });
    });

    // Application initiale (traduction + états actifs) une fois le DOM prêt.
    translateDom(lang);
    updateSegActive();
    notifyMainLang(lang);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady);
  } else {
    onReady();
  }

  // Exposé au besoin pour d'autres modules.
  window.AppSettings = {
    getTheme: () => theme,
    getLang: () => lang,
    applyTheme,
    applyLang,
    t: (key, params) => t(key, lang, params),
  };
})();
