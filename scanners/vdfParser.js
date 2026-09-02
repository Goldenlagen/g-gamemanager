'use strict';

/**
 * Parseur minimaliste du format texte VDF/KeyValues utilisé par Steam
 * (libraryfolders.vdf, appmanifest_*.acf). Retourne un objet JS imbriqué
 * dont toutes les clés sont mises en minuscules (pour un accès simple et
 * insensible à la casse, comme le fait le fichier source de Valve).
 *
 * Exemple :
 *   "AppState"
 *   {
 *       "appid"   "1245620"
 *       "name"    "ELDEN RING"
 *   }
 * devient : { appstate: { appid: '1245620', name: 'ELDEN RING' } }
 */
function parseVdf(text) {
  let pos = 0;

  function skipWhitespaceAndComments() {
    while (pos < text.length) {
      const c = text[pos];
      if (/\s/.test(c)) {
        pos++;
      } else if (c === '/' && text[pos + 1] === '/') {
        while (pos < text.length && text[pos] !== '\n') pos++;
      } else {
        break;
      }
    }
  }

  function readQuotedString() {
    pos++; // saute le guillemet ouvrant
    let out = '';
    while (pos < text.length && text[pos] !== '"') {
      if (text[pos] === '\\' && pos + 1 < text.length) {
        out += text[pos + 1];
        pos += 2;
        continue;
      }
      out += text[pos];
      pos++;
    }
    pos++; // saute le guillemet fermant
    return out;
  }

  function parseBlock() {
    const node = {};
    while (pos < text.length) {
      skipWhitespaceAndComments();
      if (pos >= text.length) break;

      if (text[pos] === '}') {
        pos++;
        return node;
      }

      if (text[pos] !== '"') {
        pos++; // caractère inattendu, on avance pour éviter une boucle infinie
        continue;
      }

      const key = readQuotedString().toLowerCase();

      skipWhitespaceAndComments();
      if (pos >= text.length) break;

      if (text[pos] === '{') {
        pos++;
        node[key] = parseBlock();
      } else if (text[pos] === '"') {
        node[key] = readQuotedString();
      }
    }
    return node;
  }

  return parseBlock();
}

module.exports = { parseVdf };
