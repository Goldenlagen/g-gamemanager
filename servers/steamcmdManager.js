'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFile } = require('child_process');
const { app } = require('electron');
const processManager = require('./processManager');

const STEAMCMD_URL = 'https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip';
const PROCESS_ID = 'steamcmd';

function getSteamCmdDir() {
  return path.join(app.getPath('userData'), 'steamcmd');
}

function getSteamCmdExePath() {
  return path.join(getSteamCmdDir(), 'steamcmd.exe');
}

function isInstalled() {
  return fs.existsSync(getSteamCmdExePath());
}

function httpsGetFollowRedirects(url, maxRedirects, cb) {
  https
    .get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && maxRedirects > 0) {
        res.resume(); // vide la réponse actuelle avant de suivre la redirection
        httpsGetFollowRedirects(res.headers.location, maxRedirects - 1, cb);
      } else {
        cb(null, res);
      }
    })
    .on('error', (err) => cb(err));
}

function extractZip(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    const escZip = zipPath.replace(/'/g, "''");
    const escDest = destDir.replace(/'/g, "''");

    execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy', 'Bypass',
        '-Command',
        `Expand-Archive -LiteralPath '${escZip}' -DestinationPath '${escDest}' -Force`,
      ],
      { windowsHide: true, timeout: 60000 },
      (err) => (err ? reject(err) : resolve())
    );
  });
}

/**
 * Télécharge steamcmd.zip depuis le CDN officiel de Valve et l'extrait via
 * PowerShell (Expand-Archive, disponible nativement sur Windows 10+, donc
 * aucune dépendance npm de décompression nécessaire).
 */
function download() {
  return new Promise((resolve) => {
    const dir = getSteamCmdDir();
    fs.mkdirSync(dir, { recursive: true });
    const zipPath = path.join(dir, 'steamcmd.zip');

    httpsGetFollowRedirects(STEAMCMD_URL, 5, (err, response) => {
      if (err) {
        resolve({ ok: false, error: `Échec du téléchargement : ${err.message}` });
        return;
      }
      if (response.statusCode !== 200) {
        resolve({ ok: false, error: `Échec du téléchargement (code HTTP ${response.statusCode}).` });
        return;
      }

      const file = fs.createWriteStream(zipPath);
      response.pipe(file);

      file.on('finish', () => {
        file.close(async () => {
          try {
            await extractZip(zipPath, dir);
            fs.unlink(zipPath, () => {}); // nettoyage best-effort, non bloquant

            if (isInstalled()) {
              resolve({ ok: true });
            } else {
              resolve({ ok: false, error: "L'extraction n'a pas produit steamcmd.exe (archive inattendue)." });
            }
          } catch (extractErr) {
            resolve({ ok: false, error: `Échec de l'extraction : ${extractErr.message}` });
          }
        });
      });

      file.on('error', (fileErr) => {
        resolve({ ok: false, error: `Échec de l'écriture du fichier : ${fileErr.message}` });
      });
    });
  });
}

function launch() {
  if (!isInstalled()) {
    return { ok: false, error: "SteamCMD n'est pas installé. Utilise le bouton de téléchargement d'abord." };
  }
  return processManager.startProcess(PROCESS_ID, getSteamCmdExePath(), [], { cwd: getSteamCmdDir() });
}

function stop() {
  return processManager.stopProcess(PROCESS_ID, { graceful: false });
}

function forceStop() {
  return processManager.forceStop(PROCESS_ID);
}

function sendCommand(command) {
  return processManager.sendCommand(PROCESS_ID, command);
}

function getStatus() {
  return processManager.getState(PROCESS_ID);
}

/**
 * Réinitialise complètement SteamCMD : arrête toute session en cours puis
 * supprime l'intégralité de son dossier d'installation. Utile en cas de
 * corruption interne (message "didn't shutdown cleanly" / "missing
 * configuration"), qui survient typiquement après un arrêt brutal de
 * SteamCMD (plantage, arrêt forcé, conflit entre deux instances...) — la
 * suppression complète est le moyen le plus fiable de repartir d'un état
 * propre, plutôt que de deviner quels fichiers internes sont corrompus.
 */
function reset() {
  if (processManager.isRunning(PROCESS_ID)) {
    processManager.forceStop(PROCESS_ID);
  }

  try {
    fs.rmSync(getSteamCmdDir(), { recursive: true, force: true });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = {
  getSteamCmdDir,
  getSteamCmdExePath,
  isInstalled,
  download,
  launch,
  stop,
  forceStop,
  sendCommand,
  getStatus,
  reset,
  PROCESS_ID,
};
