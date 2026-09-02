'use strict';

/**
 * Parseur du format server.properties de Minecraft : lignes "clé=valeur",
 * commentaires "#", lignes vides. Conserve la structure complète (ordre,
 * commentaires) sous forme de tableau de descripteurs de ligne, pour pouvoir
 * réécrire le fichier fidèlement après modification (on ne veut surtout pas
 * perdre les commentaires ou réordonner les clés d'un fichier existant).
 */
function parsePropertiesFile(content) {
  const lines = content.split(/\r?\n/);
  return lines.map((raw) => {
    const trimmed = raw.trim();

    if (trimmed === '') return { type: 'blank' };
    if (trimmed.startsWith('#')) return { type: 'comment', raw };

    const eqIndex = raw.indexOf('=');
    if (eqIndex === -1) return { type: 'unknown', raw };

    const key = raw.slice(0, eqIndex).trim();
    const value = raw.slice(eqIndex + 1);
    return { type: 'entry', key, value };
  });
}

function serializePropertiesFile(lines) {
  return lines
    .map((line) => {
      switch (line.type) {
        case 'entry':
          return `${line.key}=${line.value}`;
        case 'comment':
        case 'unknown':
          return line.raw;
        case 'blank':
        default:
          return '';
      }
    })
    .join('\n');
}

/** Retourne un objet clé -> valeur à partir des lignes parsées (pour peupler le formulaire). */
function getValues(lines) {
  const values = {};
  for (const line of lines) {
    if (line.type === 'entry') values[line.key] = line.value;
  }
  return values;
}

/**
 * Applique un objet de mises à jour {clé: nouvelleValeur} aux lignes existantes :
 * met à jour les entrées déjà présentes, ajoute les nouvelles clés à la fin.
 * Ne mute pas le tableau d'origine (retourne un nouveau tableau).
 */
function applyUpdates(lines, updates) {
  const result = lines.map((line) => ({ ...line }));
  const remainingKeys = new Set(Object.keys(updates));

  for (const line of result) {
    if (line.type === 'entry' && Object.prototype.hasOwnProperty.call(updates, line.key)) {
      line.value = updates[line.key];
      remainingKeys.delete(line.key);
    }
  }

  for (const key of remainingKeys) {
    result.push({ type: 'entry', key, value: updates[key] });
  }

  return result;
}

module.exports = { parsePropertiesFile, serializePropertiesFile, getValues, applyUpdates };
