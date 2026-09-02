# G-GameManager — version Electron

Une application Windows façon **Steam Big Picture**, écrite en **HTML/CSS/JS + Electron**
cette fois (plus simple à builder qu'une appli C#/WPF, sans les soucis d'ambiguïté de
namespace qu'on a eus). Elle détecte automatiquement tes jeux Steam, Epic, GOG, Battle.net
et Riot Games, les affiche dans une grille plein écran navigable au clavier, à la souris
ou à la manette, et peut se lancer automatiquement à l'ouverture de session.

J'ai testé unitairement toute la logique de scan (parseur VDF, lecture registre, filtrage
des manifestes, navigation spatiale de la grille...) directement en Node.js avant de te
livrer le projet — cette partie-là est donc validée. Seule l'intégration Electron complète
(fenêtre, tray, IPC bout-en-bout) n'a pas pu être testée ici faute d'environnement Windows/
affichage graphique, donc s'il reste un petit accroc au premier lancement, envoie-moi
l'erreur et je corrige.

> ⚠️ **Si tu utilisais déjà une version précédente de cette appli** (sous le nom "Ma
> Ludothèque") : Electron déduit automatiquement le dossier de données du champ `name` de
> `package.json`, qui vient de changer. L'appli va donc repartir avec un dossier de données
> neuf (`%AppData%\g-gamemanager\` au lieu de `%AppData%\ma-ludotheque\`) — tes
> dossiers racine Minecraft/Ark configurés, ta liste de jeux ajoutés manuellement et ton
> installation de SteamCMD seront à reconfigurer/retélécharger une fois. Rien n'est perdu
> sur le disque (tes serveurs et jeux restent où ils étaient), c'est juste la configuration
> de l'appli elle-même qui redémarre à zéro.

---

## 1. Installer et lancer (mode développement)

Prérequis : [Node.js](https://nodejs.org/) (version 18 ou plus récente).

```powershell
cd GameLauncherHub-Electron
npm install
npm start
```

`npm install` télécharge Electron (~200 Mo la première fois, c'est normal). `npm start`
ouvre directement l'appli en plein écran.

---

## 2. Générer un vrai .exe installable

```powershell
npm run dist
```

Ça produit un installeur Windows (NSIS) dans le dossier `dist\`, par exemple
`dist\G-GameManager Setup 1.0.0.exe`. C'est ce fichier que tu peux exécuter pour installer
l'appli normalement (raccourci Bureau + menu Démarrer inclus).

> ⚠️ **Piège classique corrigé** : par défaut, electron-builder empaquette tout le code dans
> une archive `app.asar`, une archive virtuelle que seuls Node/Electron savent lire. Un
> programme externe comme `powershell.exe` (utilisé pour l'extraction d'icônes) ne peut PAS
> ouvrir un fichier "à l'intérieur" de cette archive — ce qui provoque une erreur "chemin
> introuvable" une fois l'appli empaquetée, alors que tout fonctionne normalement en mode
> développement (`npm start`, sans asar). Le script `extract-icon.ps1` est donc configuré en
> `asarUnpack` (voir `package.json`) pour être extrait sur disque à l'installation, et le code
> qui construit son chemin (`scanners/iconExtractor.js`) redirige automatiquement vers cet
> emplacement réel quand l'appli tourne empaquetée.

---

## 3. Cache et resynchronisation

Pour éviter de rescanner tous les launchers à chaque ouverture (ce qui peut prendre
quelques secondes), la liste des jeux est enregistrée dans
`%AppData%\g-gamemanager\games_cache.json` après chaque scan complet. Au démarrage,
si ce cache a moins d'une semaine, il est utilisé tel quel et l'appli s'ouvre
instantanément ; sinon un scan complet est relancé automatiquement.

Le bouton **⟳ Resynchroniser** en haut de l'écran force un scan complet immédiat,
peu importe l'âge du cache — utile juste après avoir installé un nouveau jeu.
L'ajout ou la suppression d'un jeu manuel déclenche aussi automatiquement une
resynchronisation immédiate. La date de dernière synchronisation est visible dans
**⚙ Paramètres**.

Pendant qu'une synchronisation est en cours (au démarrage ou via le bouton), **toute
l'application est verrouillée** — pas seulement la grille de jeux : impossible de changer
d'onglet (Minecraft/Ark/Performance), d'utiliser la recherche ou le filtre, ou de
déclencher quoi que ce soit au clavier/à la manette tant que la liste n'est pas
stabilisée. Seule la réduction dans la zone de notification (bouton "—" ou touche Échap)
reste volontairement disponible, pour pouvoir masquer l'appli pendant qu'elle synchronise
en arrière-plan.

## 4. Lancer au démarrage de Windows

Dans l'appli, clique sur **⚙ Paramètres** puis coche **"Lancer au démarrage de Windows"**.
Ça utilise l'API native d'Electron (`app.setLoginItemSettings`), qui gère elle-même la
clé de démarrage Windows — pas de code registre à maintenir à la main. Au prochain
démarrage de session, l'app se lance directement réduite dans la zone de notification
(argument `--minimized`) plutôt que d'ouvrir le plein écran immédiatement.

---

## 5. Comment ça détecte tes jeux

| Plateforme | Méthode de détection | Fiabilité |
|---|---|---|
| **Steam** | Lit `libraryfolders.vdf` + les fichiers `appmanifest_*.acf` dans chaque bibliothèque | Très fiable |
| **Epic Games** | Lit les manifestes JSON dans `%ProgramData%\Epic\EpicGamesLauncher\Data\Manifests` | Très fiable |
| **GOG** (Galaxy) | Lit la clé de registre `GOG.com\Games` (via `reg.exe`, sans dépendance native) | Très fiable |
| **Battle.net** | Cherche dans les programmes désinstallables Windows les entrées dont l'éditeur est "Blizzard Entertainment" | Fiable pour la plupart des jeux Blizzard récents |
| **Origin / EA App** | Lit les clés de registre `Origin Games\*` (Install Dir) + les manifestes `.mfst` dans `%ProgramData%\Origin\LocalContent` | Fiable |
| **Ubisoft Connect** | Lit la clé de registre `Ubisoft\Launcher\Installs\*` (InstallDir) ; le nom affiché vient du nom du dossier d'installation car Ubisoft ne stocke que des IDs numériques localement. La jaquette est cherchée dans cet ordre : cache local de l'application Ubisoft Connect, puis fichiers du jeu (images contenant "cover"/"logo"/"boxart"...), puis icône extraite de l'exécutable en dernier recours | Fiable pour la détection, nom parfois approximatif |
| **Riot Games** (League of Legends, VALORANT, Legends of Runeterra) | Lit les métadonnées `%ProgramData%\Riot Games\Metadata\*.live\*.product_settings.yaml` (chemin d'installation exact), avec repli sur des dossiers par défaut | Fiable |
| **Microsoft / Xbox** | Minecraft (Java) : cherché dans les programmes désinstallables Windows. Minecraft (Bedrock) et les autres jeux Xbox/Game Pass PC : détectés via `Get-AppxPackage` (paquets Microsoft Store) recoupé avec les dossiers `XboxGames` sur chaque disque ; lancés via la méthode standard `shell:appsFolder\<PackageFamilyName>!App`. Un jeu Xbox trouvé sans correspondance de paquet est ignoré plutôt que deviné (pas de moyen fiable de le lancer sinon) | Fiable pour Minecraft, best effort pour le reste des jeux Xbox/Game Pass |
| **Sans launcher** (désactivé par défaut, voir Paramètres) | Parcourt tous les programmes désinstallables Windows, en excluant les éditeurs déjà couverts ci-dessus et une liste de mots-clés associés à des logiciels non-jeu (pilotes, runtimes, utilitaires...) | Best effort, volontairement désactivé par défaut : peut inclure quelques logiciels qui ne sont pas des jeux |
| **Manuel** | Tu ajoutes toi-même un `.exe` ou un raccourci `.lnk` via **"+ Ajouter un jeu"** | 100 % fiable, à utiliser en secours |

**Si un jeu n'apparaît pas automatiquement**, utilise **"+ Ajouter un jeu"** — ça marche
pour n'importe quel exécutable, même hors des launchers listés ci-dessus.

Les icônes des jeux sont extraites directement des `.exe` via un petit script PowerShell
invisible, puis mises en cache — aucune dépendance npm native à compiler, ce qui rend
`npm install` rapide et sans surprise. L'extraction utilise la même API que l'Explorateur
Windows pour ses grandes icônes (`SHGetImageList`/`IImageList`, via un vrai `HICON`), plutôt
qu'une reconstruction manuelle depuis la mémoire brute d'un bitmap — une première version basée
sur cette dernière technique s'est révélée peu fiable (icônes inversées verticalement pour
certains exécutables selon leur format de stockage interne, de façon imprévisible).

> ⚠️ **Icônes déjà en cache** : si tu avais déjà lancé l'appli avant cette version, les
> anciennes icônes (potentiellement inversées) resteront affichées tant que le cache n'est
> pas vidé — supprime le dossier `%AppData%\g-gamemanager\icons\` pour forcer une
> nouvelle extraction. Les jaquettes Steam ne sont pas concernées (elles viennent
> directement du CDN Valve, pas de cette extraction). Pour **Ubisoft Connect** spécifiquement,
> si une jaquette reste inversée même après avoir vidé ce cache, le problème vient
> probablement d'une image trouvée directement dans les fichiers du jeu (voir section
> précédente) plutôt que de l'extraction elle-même — ce sont deux mécanismes distincts, et
> l'orientation d'un fichier fourni par le jeu ou le launcher n'est pas modifiable par l'appli.

---

## 6. Utilisation

- **Flèches directionnelles** : naviguer dans la grille (calcul de position réelle à
  l'écran, donc ça suit vraiment la disposition visuelle, pas juste l'ordre de la liste)
- **Entrée** ou **double-clic** : lancer le jeu sélectionné
- **Échap** : réduire l'appli dans la zone de notification
- **Ctrl+F** : aller directement à la recherche
- **Manette Xbox / PlayStation / compatible** : croix directionnelle ou stick gauche pour
  naviguer, bouton **A/Croix** pour lancer, bouton **B/Rond** pour réduire — via l'API
  Gamepad standard du navigateur intégrée à Electron, aucune configuration nécessaire.
- Le menu déroulant **"Plateforme"** filtre par launcher, la barre de recherche filtre par nom.
- Les jeux sont **regroupés par launcher** (Steam, puis Epic, GOG, Battle.net, Origin,
  Ubisoft, Riot, puis les ajouts manuels), triés alphabétiquement au sein de chaque groupe,
  avec un en-header visuel entre chaque section — plutôt qu'une seule liste alphabétique où
  tous les launchers sont mélangés. Ces en-têtes n'apparaissent que quand plusieurs
  plateformes sont affichées en même temps (pas quand un filtre "Plateforme" est actif).

---

## 7. Structure du projet

```
GameLauncherHub-Electron/
├── package.json           → dépendances + config electron-builder
├── main.js                → processus principal (fenêtre, tray, IPC, lancement des jeux)
├── preload.js              → pont sécurisé entre le processus principal et l'interface
├── renderer/
│   ├── index.html          → structure de l'interface
│   ├── style.css           → thème sombre façon Big Picture
│   ├── renderer.js         → logique interface : grille, filtres, navigation clavier/manette
│   └── assets/             → icônes
│   ├── minecraft.js         → logique de l'onglet Serveurs Minecraft
│   ├── ark.js               → logique de l'onglet Serveurs Ark
│   ├── steamcmd.js          → logique du panneau SteamCMD (dans l'onglet Ark)
│   └── performance.js       → logique de l'onglet Performance (polling CPU/RAM/disques)
├── scanners/
│   ├── vdfParser.js         → parseur du format Steam VDF
│   ├── registryHelper.js    → lecture du registre Windows via reg.exe
│   ├── iconExtractor.js     → extraction d'icônes via PowerShell
│   ├── steamScanner.js
│   ├── epicScanner.js
│   ├── gogScanner.js
│   ├── battlenetScanner.js
│   ├── originScanner.js
│   ├── ubisoftScanner.js
│   ├── microsoftScanner.js  → Minecraft (Java/Bedrock) + jeux Xbox/Microsoft Store
│   ├── standaloneScanner.js → jeux sans launcher tiers (best effort, désactivé par défaut)
│   ├── riotScanner.js
│   ├── manualGames.js       → jeux ajoutés à la main + résolution de raccourcis .lnk
│   ├── gameCache.js         → cache JSON des jeux + logique de resynchronisation hebdomadaire
│   └── scanAll.js           → lance tous les scanners en parallèle
├── services/
│   ├── propertiesFile.js    → parseur server.properties (Minecraft), round-trip fidèle
│   ├── iniFile.js           → parseur INI à sections (Ark), gère les clés dupliquées
│   ├── systemMonitor.js     → usage CPU/RAM/disques (os natif + PowerShell/CIM)
│   ├── folderStats.js       → taille/nombre de fichiers d'un dossier (progression d'installation)
│   └── appSettings.js       → réglages persistants de l'appli (ex: activation du scan "sans launcher")
├── servers/
│   ├── minecraftManager.js  → détection, lecture/écriture server.properties/user_jvm_args.txt
│   ├── arkManager.js        → détection (+ auto-détection via Steam), lecture/écriture .ini
│   ├── processManager.js    → lancement/arrêt suivi des serveurs : capture console, statut, diffusion IPC
│   └── steamcmdManager.js   → téléchargement/lancement de SteamCMD (réutilise processManager)
└── build/
    └── icon.ico             → icône de l'application et de l'installeur
```

Chaque scanner est indépendant et avale ses propres erreurs (`scanAll.js` les isole), donc
un launcher qui plante ou n'est pas installé ne bloque jamais les autres.

---

## 8. Onglet Serveurs Minecraft

Un onglet dédié en haut de l'appli permet de gérer tes serveurs Minecraft :

- **Choisir le dossier** contenant tes serveurs (celui qui contient un sous-dossier par serveur).
- Détection automatique de chaque serveur (présence de `server.properties`, `eula.txt` ou d'un `.jar`) et de son **script de lancement** (`.ps1` en priorité, `.bat` en repli — en privilégiant les noms contenant "start"/"run"/"launch"/"server" s'il y en a plusieurs).
- **Console intégrée** : la sortie du serveur (logs, messages de connexion des joueurs, erreurs...) s'affiche directement dans l'appli, pas dans une fenêtre séparée.
- **Indicateur de statut** (point vert/rouge/orange) à côté du nom du serveur, aussi bien dans la liste que dans la fiche détaillée : vert = en cours d'exécution, rouge = arrêté (ou plantage), orange = démarrage en cours.
- **Message d'erreur explicite** si le lancement échoue (script introuvable, crash au démarrage...), affiché dans un bandeau au-dessus de la console.
- Bouton **Arrêter le serveur** : envoie la commande `stop` sur l'entrée standard (comme si tu la tapais toi-même dans la console), pour laisser le serveur sauvegarder le monde avant de quitter — pas un arrêt brutal.
- Si le serveur ne s'est pas réellement arrêté après 25 secondes, un bandeau d'avertissement propose d'utiliser **Forcer l'arrêt** plutôt que de le faire automatiquement — l'arrêt forcé ne laisse pas le temps de sauvegarder, donc la décision reste toujours entre tes mains.
- **Envoie des commandes** directement depuis la console intégrée une fois le serveur démarré (ex: `say Bonjour`, `op MonPseudo`, `whitelist add ...`) — le champ de saisie n'est actif que lorsque le serveur est réellement en cours d'exécution.
- **Forcer l'arrêt** : certains scripts de lancement (notamment ceux avec redémarrage automatique) affichent un message demandant d'appuyer sur Ctrl+C pour empêcher un redémarrage — un signal système qu'on ne peut pas simuler en envoyant du texte sur l'entrée standard. Dans ce cas, utilise le bouton **⛔ Forcer l'arrêt**, qui tue directement (via `taskkill /T /F`) tout l'arbre de processus — le script ET le Java qu'il a lancé — quel que soit ce qui le bloque. Contrairement à « Arrêter », il ne laisse pas le temps au serveur de sauvegarder proprement.
- La console, les arguments JVM et les propriétés du serveur occupent toute la largeur de la fenêtre pour une meilleure lisibilité ; les **arguments JVM sont affichés au-dessus des propriétés du serveur**.
- Édition de **tous les paramètres de `server.properties`** via un formulaire généré dynamiquement à partir du contenu réel du fichier (case à cocher pour les valeurs vrai/faux, champ numérique pour les nombres, texte sinon) — l'ordre, les commentaires et les clés inconnues du fichier sont préservés à l'enregistrement, et une sauvegarde `.bak` est créée automatiquement avant chaque écriture.
- Édition des **arguments de lancement JVM** via le mécanisme standard `user_jvm_args.txt` (utilisé nativement par Mojang/Forge/NeoForge/Fabric depuis plusieurs années) plutôt que par réécriture risquée d'un script inconnu. Si ton script de lancement utilise déjà `java @user_jvm_args.txt -jar server.jar nogui`, les arguments sont pris en compte automatiquement ; sinon l'appli te l'indique clairement.

## 9. Onglet Serveurs Ark

Un second onglet gère tes serveurs Ark (Survival Evolved et Ascended) :

- **Détection automatique du dossier**, en deux temps : l'appli cherche d'abord rapidement dans tes bibliothèques Steam classiques un dossier `ARK Survival Ascended Dedicated Server` ou `ARK Survival Evolved Dedicated Server`. Si rien n'est trouvé (par exemple si le serveur a été installé via **SteamCMD autonome**, un outil indépendant du client Steam principal souvent utilisé pour les serveurs dédiés, ou dans un dossier totalement personnalisé), elle parcourt automatiquement tes disques à la recherche de n'importe quel dossier contenant une structure `ShooterGame` reconnaissable — peu importe son nom ou son emplacement. Cette recherche plus large peut prendre quelques instants la première fois (un message te l'indique), mais n'est faite qu'une seule fois : le résultat est mémorisé. Tu peux bien sûr changer le dossier manuellement via **"Choisir le dossier"** à tout moment.
- **Organisation automatique par édition** : un serveur créé via l'assistant est toujours rangé dans un sous-dossier `ARK Survival Ascended\` ou `ARK Survival Evolved\` du dossier racine (créé automatiquement s'il n'existe pas), selon l'édition choisie — pratique pour gérer plusieurs serveurs des deux éditions sans les mélanger. Les serveurs déjà existants directement à la racine (créés avant cette organisation, ou détectés/installés manuellement) restent bien sûr toujours détectés.
- Sélection de la **carte** (liste des cartes officielles Evolved/Ascended les plus courantes, ou carte personnalisée/moddée en texte libre) et des paramètres de session (nom, mots de passe, joueurs max, ports). Le menu Carte est automatiquement filtré selon l'édition sélectionnée (ou, pour un serveur déjà installé, selon l'exécutable réellement présent sur le disque) — impossible de choisir par erreur une carte Evolved pour un serveur Ascended (ou l'inverse), ce qui provoquait auparavant le lancement du mauvais exécutable malgré la carte choisie.
  - **Vérification de sécurité après installation** : même en cas de configuration cohérente côté interface, un cache SteamCMD corrompu peut installer silencieusement les mauvais fichiers (voir "Réinitialiser SteamCMD" plus haut). L'assistant vérifie donc, une fois l'installation terminée, que l'exécutable réellement présent correspond bien à l'édition demandée — en cas d'incohérence, il **refuse de lancer le serveur** et affiche un message explicite plutôt que de démarrer silencieusement le mauvais jeu.
- **Console intégrée**, **indicateur de statut** (vert/rouge/orange) et **message d'erreur explicite** en cas d'échec de lancement, exactement comme pour Minecraft.
- Bouton **Arrêter le serveur** (arrêt direct du processus — Ark n'a pas de commande d'arrêt propre standard comme Minecraft) et bouton **⛔ Forcer l'arrêt** (tue tout l'arbre de processus via `taskkill /T /F`, utile si un script wrapper reste bloqué).
- **Champ de commande** dans la console, actif une fois le serveur lancé — attention cependant : contrairement à Minecraft, les serveurs Ark dédiés ne lisent généralement pas les commandes via l'entrée standard (ils utilisent le protocole RCON), donc l'envoi peut n'avoir aucun effet selon ta configuration. L'appli te le rappelle directement dans l'interface.
- La console occupe toute la largeur de la fenêtre pour une meilleure lisibilité.
- Édition des **paramètres serveur courants** (PvE, Hardcore, difficulté, multiplicateurs XP/domestication/récolte...) directement dans `GameUserSettings.ini`, plus un **éditeur avancé** listant tous les réglages `[ServerSettings]` présents et permettant d'en ajouter de nouveaux.
- Bouton **🛠 Setup Ark Server** : pour un serveur **déjà installé** (SteamCMD n'est pas requis pour ça), applique en un seul clic la carte/session choisie et les paramètres serveur courants (PvE, difficulté, multiplicateurs...), puis lance directement — pratique pour ne pas avoir à cliquer sur chaque bouton "Enregistrer" séparément avant de lancer.
- Bouton **Générer un script .bat** pratique pour lancer le serveur hors de l'appli avec la même configuration.
- Comme pour Minecraft, chaque écriture de fichier `.ini` crée automatiquement une sauvegarde `.bak`.
- Après un **Arrêter**, si le serveur ne s'est pas réellement arrêté au bout de 25 secondes (script bloqué, etc.), un bandeau d'avertissement propose d'utiliser **Forcer l'arrêt** — mais rien n'est fait automatiquement, pour éviter de perdre des données non sauvegardées sans ton accord explicite.
- **Panneau SteamCMD intégré**, visible en permanence en haut de l'onglet (utile pour installer ou mettre à jour un serveur dédié Ark, ou tout autre jeu, sans passer par le client Steam complet) :
  > ⚠️ **SteamCMD ne peut tourner qu'une seule fois à la fois** (limitation de l'outil lui-même, pas de l'appli) : impossible de lancer une session manuelle pendant qu'une installation automatique (assistant "Créer un serveur") est en cours, et inversement. L'appli le détecte et affiche un message clair plutôt que de rester bloquée silencieusement.
  - Bouton **🔄 Réinitialiser SteamCMD** : en cas d'erreur `didn't shutdown cleanly` ou `missing configuration` lors d'une installation (typiquement après un arrêt brutal de SteamCMD — plantage, arrêt forcé...), ses fichiers internes peuvent être corrompus. Ce bouton supprime entièrement le dossier SteamCMD pour repartir d'une copie propre au prochain téléchargement, plutôt que d'essayer de deviner quel fichier interne est en cause.
  - Bouton **⬇ Télécharger SteamCMD** : télécharge la dernière version depuis le CDN officiel de Valve et l'installe dans le dossier de données de l'appli (`%AppData%\g-gamemanager\steamcmd\`).
  - Bouton **▶ Lancer SteamCMD** : ouvre une session interactive directement dans la console intégrée (mêmes indicateurs de statut vert/rouge et boutons Arrêter/Forcer l'arrêt que pour un serveur).
  - Champ de commande + raccourcis pré-remplis (`login anonymous`, mise à jour Ark Ascended/Evolved, `quit`) — les raccourcis remplissent juste le champ, c'est à toi de valider l'envoi.
- **✨ Créer un serveur** : assistant qui installe, configure et lance un serveur Ark tout neuf en un clic. Choisis l'édition (Ascended/Evolved), la carte, le nom de session, les mots de passe, les ports, le mode PvE/PvP, la difficulté, le **niveau maximum des dinosaures sauvages** (150 par défaut — voir ci-dessous) et les multiplicateurs XP/domestication/récolte, puis valide. En coulisses, l'appli :
  1. installe le serveur dédié via SteamCMD en mode non interactif (`+force_install_dir ... +login anonymous +app_update <id> validate +quit`) dans un nouveau sous-dossier **automatiquement rangé par édition** (`ARK Survival Ascended\` ou `ARK Survival Evolved\`, créé s'il n'existe pas encore) du dossier racine choisi — la progression du téléchargement s'affiche en direct dans une console dédiée ;
  2. écrit tes réglages choisis dans `GameUserSettings.ini` ;
  3. enregistre la configuration de carte/session ;
  4. lance automatiquement le serveur.

  Nécessite d'avoir déjà téléchargé SteamCMD (panneau ci-dessus) et sélectionné un dossier racine. Le téléchargement peut prendre plusieurs minutes selon ta connexion ; chaque étape peut échouer indépendamment (l'appli te dit précisément laquelle en cas de problème, ex: SteamCMD manquant, installation incomplète...) plutôt que d'échouer silencieusement.

  **Absence de sortie console pendant l'installation** : SteamCMD bufferise souvent entièrement
  sa sortie standard quand elle n'est pas exécutée dans un vrai terminal interactif, et peut donc
  rester silencieux plusieurs minutes même quand le téléchargement avance normalement. Pour ne pas
  laisser l'utilisateur dans le doute, l'assistant surveille en parallèle la taille réelle du
  dossier d'installation (nombre de fichiers + poids total) toutes les 2 secondes, et affiche cette
  progression indépendamment de la console — une preuve concrète que l'installation avance, même
  quand SteamCMD lui-même n'affiche rien.

  **Niveau max des dinosaures sauvages** : Ark contrôle ça via le paramètre `OverrideOfficialDifficulty`
  de `GameUserSettings.ini`, selon la formule *niveau max ≈ 30 × cette valeur* (30 étant le niveau max
  par défaut d'un serveur officiel). Plutôt que de te faire manipuler ce multiplicateur, l'appli te
  demande directement le niveau souhaité (150 par défaut, le standard le plus courant sur les serveurs
  communautaires) et calcule la valeur pour toi. Ce même réglage est aussi éditable après coup pour un
  serveur déjà créé, dans la section « Paramètres serveur courants » de sa fiche détail.

**Limite connue** : les clés dupliquées dans `GameUserSettings.ini` (ex: plusieurs lignes `ConfigOverrideItemMaxQuantity=...`) ne sont pas parfaitement gérées individuellement par l'éditeur avancé — l'enregistrement cible la première occurrence trouvée. C'est un cas rare ; la plupart des réglages Ark n'utilisent pas de clés dupliquées.

## 10. Onglet Performance

Un troisième onglet affiche l'usage des ressources de ta machine, rafraîchi automatiquement
toutes les 2 secondes tant que l'onglet est affiché (le suivi s'arrête dès que tu changes
d'onglet, pour ne rien consommer inutilement en arrière-plan) :

- **Processeur (CPU)** : pourcentage d'usage global, modèle du processeur, et une jauge par
  cœur logique. Mesuré en comparant deux instantanés séparés de 300 ms (une lecture unique de
  `os.cpus()` ne donne que des temps cumulés depuis le démarrage de Windows, pas un taux
  instantané).
- **Mémoire (RAM)** : quantité utilisée / totale et pourcentage.
- **Carte graphique (GPU)** : nom et mémoire vidéo (VRAM) via WMI, et taux d'utilisation via le
  même compteur de performance Windows qu'utilise le Gestionnaire des tâches
  (`\GPU Engine(*engtype_3D)\Utilization Percentage`). Ce compteur n'est pas garanti disponible
  sur toutes les configurations (pilote, permissions...) : le nom et la VRAM restent affichés
  même si le pourcentage d'usage indique "N/D".
- **Disques** : pour chaque disque fixe local, l'espace utilisé / total et le pourcentage, lu
  via PowerShell (`Get-CimInstance Win32_LogicalDisk`).

Les jauges passent en orange au-delà de 70 % d'usage et en rouge au-delà de 90 %, pour repérer
en un coup d'œil si la machine a de la marge pour lancer un serveur supplémentaire.

## 11. Limites connues

- La détection **Riot Games** et **Battle.net** est "best effort" car ces launchers ne
  publient pas de format de métadonnées simple et stable (contrairement à Steam/Epic/GOG) —
  utilise l'ajout manuel si besoin.
- Pas encore de tri personnalisé (favoris, temps de jeu récent...) — uniquement tri
  alphabétique.
- Pas de récupération de jaquettes haute résolution (type SteamGridDB) — seulement les
  icônes extraites des exécutables, ou celles du cache Steam quand disponibles.
- `npm run dist` télécharge des composants Electron/NSIS depuis Internet la première fois :
  une connexion réseau est nécessaire pour ce build (pas pour l'usage quotidien de l'appli
  une fois installée).

Si tu veux que j'ajoute une de ces améliorations, ou que je revienne à la version C#/WPF
(qui devrait maintenant compiler correctement avec les corrections apportées), dis-le-moi.
