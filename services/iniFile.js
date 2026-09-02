'use strict';

/**
 * Parseur INI générique à sections (format des fichiers de config Ark :
 * GameUserSettings.ini, Game.ini). Contrairement à server.properties, ce
 * format autorise plusieurs entrées avec la même clé dans une section (ex:
 * plusieurs lignes "ConfigOverrideItemMaxQuantity=..."), donc on conserve
 * bien toutes les occurrences sous forme de tableau ordonné, pas d'un objet.
 */
function parseIni(content) {
  const lines = content.split(/\r?\n/);
  let currentSection = null;

  return lines.map((raw) => {
    const trimmed = raw.trim();

    if (trimmed === '') return { type: 'blank' };
    if (trimmed.startsWith(';') || trimmed.startsWith('#')) return { type: 'comment', raw };

    const sectionMatch = trimmed.match(/^\[(.+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1];
      return { type: 'section', name: currentSection, raw };
    }

    const eqIndex = raw.indexOf('=');
    if (eqIndex === -1) return { type: 'unknown', raw };

    const key = raw.slice(0, eqIndex).trim();
    const value = raw.slice(eqIndex + 1);
    return { type: 'entry', section: currentSection, key, value };
  });
}

function serializeIni(lines) {
  return lines
    .map((line) => {
      switch (line.type) {
        case 'section':
          return `[${line.name}]`;
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

/** Retourne toutes les entrées {key, value} d'une section donnée, dans l'ordre, doublons inclus. */
function getSectionEntries(lines, sectionName) {
  return lines
    .filter((l) => l.type === 'entry' && l.section === sectionName)
    .map((l) => ({ key: l.key, value: l.value }));
}

/** Liste les noms de sections présentes dans le fichier, dans l'ordre d'apparition. */
function getSectionNames(lines) {
  const names = [];
  for (const line of lines) {
    if (line.type === 'section' && !names.includes(line.name)) names.push(line.name);
  }
  return names;
}

/**
 * Met à jour la valeur de la PREMIÈRE entrée correspondant à (section, key).
 * Si la clé n'existe pas encore dans cette section, une nouvelle entrée est
 * ajoutée à la fin de cette section (ou une nouvelle section est créée en fin
 * de fichier si elle n'existe pas du tout). Ne mute pas le tableau d'origine.
 */
function setEntry(lines, sectionName, key, value) {
  const result = lines.map((l) => ({ ...l }));

  for (const line of result) {
    if (line.type === 'entry' && line.section === sectionName && line.key === key) {
      line.value = value;
      return result;
    }
  }

  // Clé absente : on l'ajoute juste après la dernière entrée existante de cette section.
  let sectionExists = false;
  let insertAt = result.length;

  for (let i = 0; i < result.length; i++) {
    const line = result[i];
    if (line.type === 'section' && line.name === sectionName) {
      sectionExists = true;
      insertAt = i + 1;
    } else if (sectionExists && line.type === 'section') {
      break; // on a atteint la section suivante, on s'arrête avant elle
    } else if (sectionExists && (line.type === 'entry' || line.type === 'comment')) {
      insertAt = i + 1;
    }
  }

  if (!sectionExists) {
    result.push({ type: 'section', name: sectionName, raw: `[${sectionName}]` });
    result.push({ type: 'entry', section: sectionName, key, value });
  } else {
    result.splice(insertAt, 0, { type: 'entry', section: sectionName, key, value });
  }

  return result;
}

/** Supprime la première entrée correspondant à (section, key), si elle existe. */
function removeEntry(lines, sectionName, key) {
  const index = lines.findIndex((l) => l.type === 'entry' && l.section === sectionName && l.key === key);
  if (index === -1) return lines.map((l) => ({ ...l }));
  const result = lines.map((l) => ({ ...l }));
  result.splice(index, 1);
  return result;
}

module.exports = { parseIni, serializeIni, getSectionEntries, getSectionNames, setEntry, removeEntry };
