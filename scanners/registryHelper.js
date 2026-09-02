'use strict';

const { execFileSync } = require('child_process');

/**
 * Lit une valeur de registre via reg.exe (aucune dépendance npm native requise).
 * Retourne la valeur sous forme de chaîne, ou null si la clé/valeur n'existe pas.
 */
function queryValue(keyPath, valueName) {
  try {
    const out = execFileSync('reg', ['query', keyPath, '/v', valueName], {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });

    const lines = out.split(/\r?\n/);
    for (const line of lines) {
      // Format d'une ligne de valeur : "    NomValeur    REG_SZ    valeur"
      const match = line.match(/^\s{2,}(\S+)\s+(REG_[A-Z_]+)\s+(.*)$/);
      if (match && match[1].toLowerCase() === valueName.toLowerCase()) {
        return match[3].trim();
      }
    }
    return null;
  } catch (err) {
    return null; // clé ou valeur absente : reg.exe retourne un code d'erreur
  }
}

const HIVE_ALIASES = {
  HKLM: 'HKEY_LOCAL_MACHINE',
  HKCU: 'HKEY_CURRENT_USER',
  HKCR: 'HKEY_CLASSES_ROOT',
  HKU: 'HKEY_USERS',
  HKCC: 'HKEY_CURRENT_CONFIG',
};

function normalizeHive(keyPath) {
  const [hive, ...rest] = keyPath.split('\\');
  const fullHive = HIVE_ALIASES[hive.toUpperCase()] || hive;
  return [fullHive, ...rest].join('\\');
}

/**
 * Énumère les noms des sous-clés directes d'une clé de registre.
 */
function listSubkeys(keyPath) {
  try {
    const out = execFileSync('reg', ['query', keyPath], {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });

    const lines = out
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    // reg.exe affiche toujours le nom complet de la ruche (HKEY_LOCAL_MACHINE)
    // même si on a interrogé avec l'abréviation (HKLM) : on normalise avant de comparer.
    const normalizedRoot = normalizeHive(keyPath).toUpperCase();
    const result = [];

    for (const line of lines) {
      if (line.toUpperCase().startsWith(normalizedRoot) && line.length > normalizedRoot.length) {
        const name = line.substring(line.lastIndexOf('\\') + 1);
        if (name) result.push(name);
      }
    }
    return result;
  } catch (err) {
    return [];
  }
}

module.exports = { queryValue, listSubkeys };
