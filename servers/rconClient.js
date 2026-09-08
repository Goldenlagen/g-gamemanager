'use strict';

// Client RCON minimal (protocole « Source RCON », celui utilisé par les serveurs
// Ark). Ouvre une connexion TCP, s'authentifie avec le mot de passe admin,
// envoie une commande, lit la réponse, puis ferme. Une connexion par commande :
// simple et robuste pour un usage ponctuel (liste des joueurs, kick, save…).
//
// Renvoie des CODES d'erreur (refused/timeout/badPassword/socket) que la couche
// IPC (main.js) traduit — pour garder tous les textes dans le module i18n.

const net = require('net');

const TYPE_AUTH = 3;
const TYPE_AUTH_RESPONSE = 2;
const TYPE_EXEC = 2;
const TYPE_RESPONSE = 0;

const AUTH_ID = 0x51; // identifiants arbitraires mais distincts
const EXEC_ID = 0x52;
const NULL_CHAR = String.fromCharCode(0);

function buildPacket(id, type, body) {
  const bodyBuf = Buffer.from(body, 'utf8');
  const size = 4 + 4 + bodyBuf.length + 2; // id + type + corps + 2 octets nuls
  const buf = Buffer.alloc(4 + size);
  buf.writeInt32LE(size, 0);
  buf.writeInt32LE(id, 4);
  buf.writeInt32LE(type, 8);
  bodyBuf.copy(buf, 12);
  buf.writeInt8(0, 12 + bodyBuf.length);
  buf.writeInt8(0, 13 + bodyBuf.length);
  return buf;
}

function cleanBody(body) {
  return body.split(NULL_CHAR).join('').replace(/\r/g, '').trim();
}

/**
 * Envoie une commande RCON et résout avec { ok:true, response } ou
 * { ok:false, error:<code>, detail? }.
 */
function rconCommand(host, port, password, command, timeoutMs = 6000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let stage = 'auth';
    let buffer = Buffer.alloc(0);
    let done = false;

    const finish = (res) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { socket.destroy(); } catch (e) { /* ignore */ }
      resolve(res);
    };

    const timer = setTimeout(() => finish({ ok: false, error: 'timeout' }), timeoutMs);

    socket.on('error', (e) => {
      const code = e && e.code === 'ECONNREFUSED' ? 'refused' : 'socket';
      finish({ ok: false, error: code, detail: e && e.message });
    });

    socket.connect(port, host, () => {
      socket.write(buildPacket(AUTH_ID, TYPE_AUTH, password));
    });

    socket.on('data', (data) => {
      buffer = Buffer.concat([buffer, data]);

      // On lit tous les paquets complets présents dans le tampon.
      while (buffer.length >= 12) {
        const len = buffer.readInt32LE(0);
        if (buffer.length < 4 + len) break; // paquet incomplet : on attend la suite

        const id = buffer.readInt32LE(4);
        const type = buffer.readInt32LE(8);
        const body = buffer.slice(12, 4 + len - 2).toString('utf8');
        buffer = buffer.slice(4 + len);

        if (stage === 'auth') {
          // Le serveur envoie parfois un paquet RESPONSE_VALUE vide avant la
          // réponse d'auth : on l'ignore. La réponse d'auth est de type 2 ;
          // id === -1 signifie mot de passe refusé.
          if (type === TYPE_AUTH_RESPONSE) {
            if (id === -1) return finish({ ok: false, error: 'badPassword' });
            stage = 'exec';
            socket.write(buildPacket(EXEC_ID, TYPE_EXEC, command));
          }
        } else if (stage === 'exec') {
          if (type === TYPE_RESPONSE) {
            return finish({ ok: true, response: cleanBody(body) });
          }
        }
      }
    });
  });
}

module.exports = { rconCommand };
