'use strict';

// i18n pour le PROCESS PRINCIPAL (Electron main).
//
// Le renderer possède son propre dictionnaire (renderer/appsettings.js) ; ce
// module est le pendant côté processus principal, pour les libellés natifs
// (menu de la zone de notification, boîtes de dialogue) et les messages
// d'erreur renvoyés au renderer (qui les affiche tels quels).
//
// La langue courante est synchronisée depuis le renderer via l'IPC « set-lang »
// (voir main.js). Node met en cache les modules requis : main.js et les
// services partagent donc la même instance et la même langue.

let currentLang = 'fr';

function setLang(l) {
  currentLang = l === 'en' ? 'en' : 'fr';
  return currentLang;
}

function getLang() {
  return currentLang;
}

// Interpolation simple : remplace {clé} par params.clé.
function interpolate(str, params) {
  if (!params || typeof str !== 'string') return str;
  return str.replace(/\{(\w+)\}/g, (m, k) => (params[k] != null ? params[k] : m));
}

function t(key, params) {
  const table = DICT[currentLang] || DICT.fr;
  const v = Object.prototype.hasOwnProperty.call(table, key) ? table[key] : key;
  return interpolate(v, params);
}

const DICT = {
  fr: {
    // Zone de notification (tray)
    'tray.open': 'Ouvrir',
    'tray.quit': 'Quitter',

    // Boîtes de dialogue natives
    'dlg.chooseExe': 'Choisir un exécutable ou un raccourci',
    'dlg.filterExe': 'Exécutables et raccourcis',
    'dlg.filterAll': 'Tous les fichiers',
    'dlg.chooseMcFolder': 'Choisir le dossier contenant vos serveurs Minecraft',
    'dlg.chooseArkFolder': 'Choisir le dossier contenant vos serveurs Ark',

    // Erreurs — Minecraft
    'err.mcNoLaunchScript': 'Aucun script de lancement détecté pour ce serveur.',
    'err.mcRootNotFound': 'Dossier racine Minecraft introuvable.',
    'err.pathOutsideRoot': 'Chemin hors du dossier racine.',

    // Erreurs — Ark
    'err.arkRootNotFound': 'Dossier racine Ark introuvable.',
    'err.arkExeNotFound': "Exécutable du serveur Ark introuvable dans ShooterGame\\Binaries\\Win64.",
    'err.steamcmdNotInstalled':
      "SteamCMD n'est pas installé. Utilise le bouton de téléchargement du panneau SteamCMD d'abord.",
    'err.steamcmdAlreadyRunning':
      "SteamCMD est déjà lancé (panneau ci-dessus). Ferme cette session (bouton « Arrêter ») avant de créer un nouveau serveur : SteamCMD ne peut pas être utilisé deux fois en même temps.",
    'err.arkUnknownEdition': 'Édition Ark inconnue (Ascended/Evolved).',
    'err.arkMissingParams': 'Dossier parent ou nom de serveur manquant.',
    'err.arkFolderExists': 'Le dossier "{name}" existe déjà et n\'est pas vide.',
    'err.arkCreateFolder': 'Impossible de créer le dossier : {error}',
    'err.arkInstallFailed': "L'installation via SteamCMD a échoué ou a été interrompue.",
    'err.arkInstallIncomplete':
      "L'installation semble incomplète : aucun exécutable serveur trouvé une fois SteamCMD terminé.",
    'err.arkEditionMismatch':
      'Incohérence détectée : tu as demandé l\'édition "{edition}" mais l\'exécutable installé ("{exe}") correspond à "{installedEdition}". SteamCMD a probablement installé les mauvais fichiers à cause d\'un cache corrompu — utilise le bouton "🔄 Réinitialiser SteamCMD" dans le panneau ci-dessus, puis retélécharge SteamCMD et réessaie. Le dossier "{folder}" a été créé mais n\'a volontairement pas été lancé.',
    'err.steamcmdInstallRunning':
      "Une installation automatique via l'assistant « Créer un serveur » est déjà en cours en arrière-plan. SteamCMD ne peut pas être lancé deux fois en même temps : attends la fin de l'installation avant de démarrer une session manuelle.",

    // Launcher Minecraft (mcp)
    'mcp.launcherNotFound':
      "Impossible de localiser le launcher Minecraft automatiquement. Le profil est pré-sélectionné : ouvre le launcher manuellement pour jouer.",

    // services/minecraftLauncher.js
    'mcl.invalidResponse': 'réponse invalide',
    'mcl.fabricProfileFail': 'Impossible de récupérer le profil Fabric ({error}).',
    'mcl.fabricWriteFail': 'Écriture du profil Fabric échouée : {error}',
    'mcl.installerDownloadFail': "Téléchargement de l'installeur {kind} échoué : {error}",
    'mcl.installerFail': "L'installeur {kind} a échoué : {error}",
    'mcl.installerNoVersion': 'Installeur {kind} terminé mais aucune version détectée dans versions/.',
    'mcl.quiltUnavailable': 'Profil Quilt indisponible.',
    'mcl.quiltWriteFail': 'Écriture du profil Quilt échouée : {error}',
    'mcl.needJava':
      "Java est introuvable sur le PATH. L'installation de {name} nécessite Java (le même que celui utilisé pour jouer). Installe Java puis réessaie.",
    'mcl.loaderUnsupported': 'Loader non pris en charge : {name}',
    'mcl.mcDirNotFound': 'Dossier .minecraft introuvable ({dir}). Le launcher Minecraft officiel est-il installé ?',
    'mcl.profilesWriteFail': 'Écriture de launcher_profiles.json échouée : {error}',
    'mcl.profileNotFound': 'Profil introuvable.',
    'mcl.profileUpdateFail': 'Impossible de mettre à jour le profil : {error}',
    'mcl.uninstallFolderFail': "Profil retiré, mais le dossier n'a pas pu être supprimé : {error}",
    'mcl.uninstallFolderSkipped':
      "Profil retiré. Le dossier de jeu n'a pas été supprimé automatiquement par précaution : {dir}",

    // Lancement rapide (hors-ligne)
    'mcl.qlNoVersion': "Ce profil n'a pas de version installée à lancer.",
    'mcl.qlVersionJsonFail': 'Impossible de lire le JSON de version {id} : {error}',
    'mcl.qlClientJarMissing':
      "Fichier client introuvable ({path}). Lance ce profil une fois via le launcher officiel pour télécharger les fichiers.",
    'mcl.qlNoJava':
      "Java introuvable. Installe Java, ou lance ce profil une fois via le launcher officiel pour installer son runtime Java.",
    'mcl.qlNativesFail': 'Extraction des bibliothèques natives échouée : {error}',
    'mcl.qlSpawnFail': 'Échec du lancement direct : {error}',

    // RCON Ark
    'rcon.disabled': "RCON désactivé pour ce serveur. Active-le dans « Carte et session », enregistre, puis relance le serveur.",
    'rcon.noPassword': "RCON nécessite un mot de passe admin. Renseigne-le dans « Carte et session », enregistre, puis relance le serveur.",
    'rcon.refused': 'Connexion RCON refusée. Le serveur est-il bien lancé, RCON activé et le port correct ?',
    'rcon.timeout': 'Délai RCON dépassé (aucune réponse du serveur).',
    'rcon.badPassword': 'Mot de passe RCON (admin) invalide.',
    'rcon.socket': 'Erreur RCON : {error}',

    // Sauvegardes Minecraft
    'backup.noWorld': "Aucun dossier de monde trouvé à sauvegarder (le serveur a-t-il déjà été lancé une fois ?).",
    'backup.failed': 'Échec de la sauvegarde : {error}',
    'backup.notFound': 'Sauvegarde introuvable.',
    'backup.restoreRunning': 'Arrête le serveur avant de restaurer une sauvegarde.',
  },
  en: {
    // Tray
    'tray.open': 'Open',
    'tray.quit': 'Quit',

    // Native dialogs
    'dlg.chooseExe': 'Choose an executable or shortcut',
    'dlg.filterExe': 'Executables and shortcuts',
    'dlg.filterAll': 'All files',
    'dlg.chooseMcFolder': 'Choose the folder containing your Minecraft servers',
    'dlg.chooseArkFolder': 'Choose the folder containing your Ark servers',

    // Errors — Minecraft
    'err.mcNoLaunchScript': 'No launch script detected for this server.',
    'err.mcRootNotFound': 'Minecraft root folder not found.',
    'err.pathOutsideRoot': 'Path outside the root folder.',

    // Errors — Ark
    'err.arkRootNotFound': 'Ark root folder not found.',
    'err.arkExeNotFound': 'Ark server executable not found in ShooterGame\\Binaries\\Win64.',
    'err.steamcmdNotInstalled': 'SteamCMD is not installed. Use the download button in the SteamCMD panel first.',
    'err.steamcmdAlreadyRunning':
      'SteamCMD is already running (panel above). Close that session ("Stop" button) before creating a new server: SteamCMD cannot be used twice at the same time.',
    'err.arkUnknownEdition': 'Unknown Ark edition (Ascended/Evolved).',
    'err.arkMissingParams': 'Parent folder or server name missing.',
    'err.arkFolderExists': 'The folder "{name}" already exists and is not empty.',
    'err.arkCreateFolder': 'Unable to create the folder: {error}',
    'err.arkInstallFailed': 'The SteamCMD installation failed or was interrupted.',
    'err.arkInstallIncomplete':
      'The installation seems incomplete: no server executable found once SteamCMD finished.',
    'err.arkEditionMismatch':
      'Inconsistency detected: you requested the "{edition}" edition but the installed executable ("{exe}") corresponds to "{installedEdition}". SteamCMD probably installed the wrong files due to a corrupted cache — use the "🔄 Reset SteamCMD" button in the panel above, then re-download SteamCMD and try again. The folder "{folder}" was created but deliberately not launched.',
    'err.steamcmdInstallRunning':
      'An automatic installation via the "Create a server" wizard is already running in the background. SteamCMD cannot be launched twice at the same time: wait for the installation to finish before starting a manual session.',

    // Minecraft launcher (mcp)
    'mcp.launcherNotFound':
      'Unable to locate the Minecraft launcher automatically. The profile is pre-selected: open the launcher manually to play.',

    // services/minecraftLauncher.js
    'mcl.invalidResponse': 'invalid response',
    'mcl.fabricProfileFail': 'Unable to fetch the Fabric profile ({error}).',
    'mcl.fabricWriteFail': 'Failed to write the Fabric profile: {error}',
    'mcl.installerDownloadFail': 'Failed to download the {kind} installer: {error}',
    'mcl.installerFail': 'The {kind} installer failed: {error}',
    'mcl.installerNoVersion': '{kind} installer finished but no version detected in versions/.',
    'mcl.quiltUnavailable': 'Quilt profile unavailable.',
    'mcl.quiltWriteFail': 'Failed to write the Quilt profile: {error}',
    'mcl.needJava':
      'Java was not found on the PATH. Installing {name} requires Java (the same one used to play). Install Java then try again.',
    'mcl.loaderUnsupported': 'Unsupported loader: {name}',
    'mcl.mcDirNotFound': '.minecraft folder not found ({dir}). Is the official Minecraft launcher installed?',
    'mcl.profilesWriteFail': 'Failed to write launcher_profiles.json: {error}',
    'mcl.profileNotFound': 'Profile not found.',
    'mcl.profileUpdateFail': 'Unable to update the profile: {error}',
    'mcl.uninstallFolderFail': 'Profile removed, but the folder could not be deleted: {error}',
    'mcl.uninstallFolderSkipped':
      'Profile removed. The game folder was not deleted automatically as a precaution: {dir}',

    // Quick launch (offline)
    'mcl.qlNoVersion': 'This profile has no installed version to launch.',
    'mcl.qlVersionJsonFail': 'Unable to read version JSON {id}: {error}',
    'mcl.qlClientJarMissing':
      'Client file not found ({path}). Launch this profile once via the official launcher to download the files.',
    'mcl.qlNoJava':
      'Java not found. Install Java, or launch this profile once via the official launcher to install its Java runtime.',
    'mcl.qlNativesFail': 'Failed to extract native libraries: {error}',
    'mcl.qlSpawnFail': 'Direct launch failed: {error}',

    // Ark RCON
    'rcon.disabled': 'RCON is disabled for this server. Enable it in "Map and session", save, then restart the server.',
    'rcon.noPassword': 'RCON requires an admin password. Set it in "Map and session", save, then restart the server.',
    'rcon.refused': 'RCON connection refused. Is the server running, RCON enabled and the port correct?',
    'rcon.timeout': 'RCON timed out (no response from the server).',
    'rcon.badPassword': 'Invalid RCON (admin) password.',
    'rcon.socket': 'RCON error: {error}',

    // Minecraft backups
    'backup.noWorld': 'No world folder found to back up (has the server been started at least once?).',
    'backup.failed': 'Backup failed: {error}',
    'backup.notFound': 'Backup not found.',
    'backup.restoreRunning': 'Stop the server before restoring a backup.',
  },
};

module.exports = { setLang, getLang, t };
