'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Calcule récursivement le nombre de fichiers et la taille totale d'un
 * dossier. Utilisé comme preuve de progression indépendante de la console
 * pendant une installation SteamCMD, car SteamCMD bufferise souvent
 * entièrement sa sortie standard quand elle est redirigée (pas un vrai
 * terminal) et peut rester silencieux plusieurs minutes même quand le
 * téléchargement avance normalement.
 */
function getFolderStats(dirPath) {
  let fileCount = 0;
  let totalBytes = 0;

  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      return; // dossier inaccessible/verrouillé temporairement : on ignore et on continue
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        fileCount++;
        try {
          totalBytes += fs.statSync(full).size;
        } catch (e) {
          // fichier supprimé/renommé entre le readdir et le stat (course normale
          // pendant une installation en cours) : on ignore simplement celui-ci
        }
      }
    }
  }

  if (fs.existsSync(dirPath)) walk(dirPath);

  return { fileCount, totalBytes };
}

module.exports = { getFolderStats };
