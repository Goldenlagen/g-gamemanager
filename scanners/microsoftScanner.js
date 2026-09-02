'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { queryValue, listSubkeys } = require('./registryHelper');
const { extractIconPng } = require('./iconExtractor');

/**
 * Interroge les paquets UWP/Microsoft Store installés via PowerShell
 * (Get-AppxPackage), la seule API fiable pour obtenir le PackageFamilyName
 * nécessaire à leur lancement — ces jeux ne s'exécutent pas comme un .exe
 * classique.
 */
function getAppxPackages() {
  return new Promise((resolve) => {
    const script =
      "Get-AppxPackage | Where-Object { $_.SignatureKind -eq 'Store' -or $_.SignatureKind -eq 'System' } | " +
      'Select-Object Name, PackageFamilyName, InstallLocation | ConvertTo-Json -Compress';

    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, timeout: 15000 },
      (err, stdout) => {
        if (err) return resolve([]);
        try {
          let parsed = JSON.parse(stdout);
          if (!Array.isArray(parsed)) parsed = [parsed];
          resolve(parsed.filter((p) => p && p.PackageFamilyName));
        } catch (e) {
          resolve([]);
        }
      }
    );
  });
}

/** Lance un paquet UWP via son PackageFamilyName (méthode standard documentée par Microsoft). */
function buildUwpLaunch(packageFamilyName) {
  return {
    launchMode: 'exe',
    launchTarget: 'explorer.exe',
    launchArgs: [`shell:appsFolder\\${packageFamilyName}!App`],
  };
}

/** Cherche une image de logo dans le dossier d'installation d'un paquet UWP (convention Assets/*Logo*). */
function findUwpIcon(installLocation) {
  if (!installLocation || !fs.existsSync(installLocation)) return null;

  const candidatesDirs = [installLocation, path.join(installLocation, 'Assets'), path.join(installLocation, 'Images')];
  let best = null;
  let bestSize = -1;

  for (const dir of candidatesDirs) {
    let files;
    try {
      files = fs.readdirSync(dir);
    } catch (e) {
      continue;
    }

    for (const file of files) {
      const lower = file.toLowerCase();
      if (!lower.endsWith('.png')) continue;
      if (!lower.includes('logo') && !lower.includes('icon') && !lower.includes('square')) continue;

      // Préfère la plus grande variante d'échelle disponible (ex: "...scale-400.png").
      const scaleMatch = lower.match(/scale-(\d+)/);
      const size = scaleMatch ? parseInt(scaleMatch[1], 10) : 100;
      if (size > bestSize) {
        bestSize = size;
        best = path.join(dir, file);
      }
    }
  }

  return best;
}

/**
 * Édition Java du Launcher Minecraft officiel (non-Store) : on cherche son
 * entrée dans les programmes désinstallables Windows plutôt que de supposer
 * un chemin d'installation fixe, pour rester correct même en install personnalisée.
 */
const UNINSTALL_ROOTS = [
  'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
];

async function scanMinecraftJavaLauncher() {
  const games = [];

  for (const root of UNINSTALL_ROOTS) {
    const ids = listSubkeys(root);
    for (const id of ids) {
      const keyPath = `${root}\\${id}`;
      const displayName = queryValue(keyPath, 'DisplayName');
      if (!displayName || !displayName.toLowerCase().includes('minecraft launcher')) continue;

      const installLocation = queryValue(keyPath, 'InstallLocation');
      if (!installLocation || !fs.existsSync(installLocation)) continue;

      let exeFiles;
      try {
        exeFiles = fs.readdirSync(installLocation).filter((f) => f.toLowerCase().endsWith('.exe'));
      } catch (e) {
        continue;
      }
      const exeFile = exeFiles.find((f) => f.toLowerCase().includes('minecraft')) || exeFiles[0];
      if (!exeFile) continue;

      const exePath = path.join(installLocation, exeFile);
      const iconPath = await extractIconPng(exePath);

      games.push({
        name: 'Minecraft',
        platform: 'microsoft',
        iconPath,
        launchMode: 'exe',
        launchTarget: exePath,
        launchArgs: [],
        workingDirectory: installLocation,
      });
      return games; // une seule entrée suffit, pas besoin de continuer à chercher
    }
  }

  return games;
}

async function tryJumboIcon(installLocation) {
  if (!installLocation || !fs.existsSync(installLocation)) return null;
  try {
    const files = fs.readdirSync(installLocation).filter((f) => f.toLowerCase().endsWith('.exe'));
    if (files.length === 0) return null;
    return await extractIconPng(path.join(installLocation, files[0]));
  } catch (e) {
    return null;
  }
}

/** Édition Bedrock de Minecraft, distribuée exclusivement via le Microsoft Store. */
async function scanMinecraftBedrock(packages) {
  const pkg = packages.find((p) => p.Name && p.Name.toLowerCase().includes('minecraftuwp'));
  if (!pkg) return [];

  const iconPath = findUwpIcon(pkg.InstallLocation) || (await tryJumboIcon(pkg.InstallLocation));

  return [
    {
      name: 'Minecraft (Bedrock)',
      platform: 'microsoft',
      iconPath,
      ...buildUwpLaunch(pkg.PackageFamilyName),
    },
  ];
}

/**
 * Détection best-effort des autres jeux Xbox/Microsoft Store (Game Pass PC) :
 * on cherche les dossiers "XboxGames" créés par l'appli Xbox sur chaque
 * disque, puis on fait correspondre chaque dossier trouvé à un paquet UWP
 * (nécessaire pour pouvoir le lancer via la méthode standard). Un dossier
 * sans correspondance est ignoré plutôt que listé sans moyen fiable de le lancer.
 */
function getCandidateDrives() {
  const drives = [];
  for (let code = 67; code <= 90; code++) {
    const drive = `${String.fromCharCode(code)}:\\`;
    if (fs.existsSync(drive)) drives.push(drive);
  }
  return drives;
}

function getXboxGameFolders() {
  const folders = [];
  for (const drive of getCandidateDrives()) {
    const xboxDir = path.join(drive, 'XboxGames');
    if (!fs.existsSync(xboxDir)) continue;

    let entries;
    try {
      entries = fs.readdirSync(xboxDir, { withFileTypes: true }).filter((e) => e.isDirectory());
    } catch (e) {
      continue;
    }

    for (const entry of entries) {
      folders.push({ name: entry.name, path: path.join(xboxDir, entry.name) });
    }
  }
  return folders;
}

function normalizeForMatch(str) {
  return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}

async function scanXboxGamePassTitles(packages) {
  const folders = getXboxGameFolders();
  const games = [];

  for (const folder of folders) {
    const folderKey = normalizeForMatch(folder.name);

    const match = packages.find((p) => {
      if (!p.Name) return false;
      const nameKey = normalizeForMatch(p.Name);
      return nameKey.includes(folderKey) || folderKey.includes(nameKey);
    });

    if (!match) continue; // pas de correspondance fiable = pas de moyen sûr de le lancer, on ignore plutôt que de deviner

    const iconPath = findUwpIcon(match.InstallLocation) || (await tryJumboIcon(folder.path));

    games.push({
      name: folder.name,
      platform: 'microsoft',
      iconPath,
      ...buildUwpLaunch(match.PackageFamilyName),
    });
  }

  return games;
}

async function scanMicrosoft() {
  const games = [];

  const javaGames = await scanMinecraftJavaLauncher();
  games.push(...javaGames);

  let packages = [];
  try {
    packages = await getAppxPackages();
  } catch (e) {
    return games; // au moins Minecraft Java aura été détecté si présent
  }

  const bedrockGames = await scanMinecraftBedrock(packages);
  games.push(...bedrockGames);

  const xboxGames = await scanXboxGamePassTitles(packages);
  games.push(...xboxGames);

  return games;
}

module.exports = {
  scanMicrosoft,
  scanMinecraftJavaLauncher,
  scanMinecraftBedrock,
  scanXboxGamePassTitles,
  getAppxPackages,
  getXboxGameFolders,
  findUwpIcon,
  normalizeForMatch,
};
