'use strict';

const { spawn, execFile } = require('child_process');

// Map serverId -> { child, status, logLines, errorMessage, exitInfo, manualStop }
const processes = new Map();

const MAX_LOG_LINES = 500;

let broadcastFn = null; // injecté par main.js : (channel, payload) => void

function setBroadcaster(fn) {
  broadcastFn = fn;
}

function broadcast(channel, payload) {
  if (broadcastFn) broadcastFn(channel, payload);
}

function appendLog(serverId, text) {
  const entry = processes.get(serverId);
  if (!entry) return;

  const newLines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (newLines.length === 0) return;

  entry.logLines.push(...newLines);
  if (entry.logLines.length > MAX_LOG_LINES) {
    entry.logLines.splice(0, entry.logLines.length - MAX_LOG_LINES);
  }

  broadcast('server-log', { serverId, lines: newLines });
}

function setStatus(serverId, status, extra = {}) {
  const entry = processes.get(serverId);
  if (!entry) return;
  entry.status = status;
  Object.assign(entry, extra);
  broadcast('server-status', {
    serverId,
    status,
    errorMessage: entry.errorMessage || null,
    exitInfo: entry.exitInfo || null,
  });
}

function isRunning(serverId) {
  const entry = processes.get(serverId);
  return !!entry && entry.status === 'running';
}

/** Vrai si au moins un processus suivi dont l'id commence par ce préfixe est en cours d'exécution. */
function isAnyRunningWithPrefix(prefix) {
  for (const [id, entry] of processes) {
    if (id.startsWith(prefix) && entry.status === 'running') return true;
  }
  return false;
}

/** État courant d'un serveur (utilisé pour resynchroniser l'UI à l'ouverture d'une fiche). */
function getState(serverId) {
  const entry = processes.get(serverId);
  if (!entry) return { status: 'stopped', logLines: [], errorMessage: null, exitInfo: null };
  return {
    status: entry.status,
    logLines: entry.logLines.slice(),
    errorMessage: entry.errorMessage || null,
    exitInfo: entry.exitInfo || null,
  };
}

/**
 * Démarre un processus serveur en capturant sa sortie (pas de fenêtre de
 * console séparée : tout est affiché dans l'application). Les mises à jour
 * d'état et de logs sont diffusées de façon asynchrone via 'server-status'
 * et 'server-log' — cette fonction retourne immédiatement.
 */
function startProcess(serverId, command, args, options = {}) {
  if (isRunning(serverId)) {
    return { ok: false, error: 'Ce serveur est déjà en cours d\'exécution.' };
  }

  let child;
  try {
    child = spawn(command, args, {
      cwd: options.cwd,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (e) {
    processes.set(serverId, { child: null, status: 'error', logLines: [], errorMessage: e.message });
    broadcast('server-status', { serverId, status: 'error', errorMessage: e.message, exitInfo: null });
    return { ok: false, error: e.message };
  }

  processes.set(serverId, {
    child,
    status: 'starting',
    logLines: [],
    errorMessage: null,
    exitInfo: null,
    manualStop: false,
  });

  broadcast('server-status', { serverId, status: 'starting', errorMessage: null, exitInfo: null });

  child.stdout.on('data', (data) => appendLog(serverId, data.toString('utf8')));
  child.stderr.on('data', (data) => appendLog(serverId, data.toString('utf8')));

  // L'évènement 'spawn' confirme que le processus a réellement démarré
  // (contrairement à 'error', qui se déclenche par exemple si l'exécutable
  // est introuvable : ENOENT).
  child.on('spawn', () => {
    setStatus(serverId, 'running');
  });

  child.on('error', (err) => {
    setStatus(serverId, 'error', { errorMessage: traduireErreur(err) });
  });

  child.on('exit', (code, signal) => {
    const entry = processes.get(serverId);
    const wasManualStop = !!(entry && entry.manualStop);
    const crashed = !wasManualStop && code !== 0 && code !== null;

    setStatus(serverId, crashed ? 'error' : 'stopped', {
      exitInfo: { code, signal },
      errorMessage: crashed ? `Le serveur s'est arrêté de façon inattendue (code de sortie ${code}).` : null,
    });
  });

  return { ok: true };
}

function traduireErreur(err) {
  if (err && err.code === 'ENOENT') {
    return "Impossible de démarrer le serveur : fichier introuvable (exécutable ou script manquant).";
  }
  return err && err.message ? err.message : 'Erreur inconnue au démarrage du serveur.';
}

/**
 * Arrête un serveur. Pour Minecraft, on préfère un arrêt "gracieux" en
 * envoyant la commande "stop" sur l'entrée standard (le serveur sauvegarde le
 * monde avant de quitter) plutôt qu'un kill brutal.
 */
function stopProcess(serverId, { graceful = false } = {}) {
  const entry = processes.get(serverId);
  if (!entry || !entry.child || entry.status !== 'running') {
    return { ok: false, error: "Ce serveur n'est pas en cours d'exécution." };
  }

  entry.manualStop = true;

  if (graceful && entry.child.stdin && entry.child.stdin.writable) {
    entry.child.stdin.write('stop\n');
  } else {
    entry.child.kill();
  }

  return { ok: true };
}

/**
 * Arrêt forcé : tue tout l'arbre de processus (script de lancement + Java/exe
 * qu'il a démarré) via taskkill /T /F. Nécessaire quand un script de
 * lancement (notamment ceux avec redémarrage automatique) reste bloqué en
 * attendant un Ctrl+C — un signal système qu'on ne peut pas simuler en
 * écrivant du texte sur l'entrée standard, contrairement à une commande
 * normale. Un simple `child.kill()` ne suffit pas non plus ici : il ne tue
 * que le processus wrapper (cmd.exe/powershell.exe), pas ses enfants déjà
 * détachés (Java...), qui continueraient de tourner orphelins.
 */
function forceStop(serverId) {
  const entry = processes.get(serverId);
  if (!entry || !entry.child || !entry.child.pid) {
    return { ok: false, error: "Ce serveur n'est pas en cours d'exécution." };
  }

  entry.manualStop = true;

  execFile('taskkill', ['/PID', String(entry.child.pid), '/T', '/F'], (err) => {
    // Rien à faire ici : la mise à jour du statut est gérée par l'évènement
    // 'exit' du processus, déclenché dès que taskkill l'aura terminé.
    if (err) {
      // Le processus était peut-être déjà mort entre-temps : on ignore.
    }
  });

  return { ok: true };
}

/** Envoie une commande arbitraire sur l'entrée standard d'un serveur actif (ex: commandes console Minecraft). */
function sendCommand(serverId, command) {
  const entry = processes.get(serverId);
  if (!entry || !entry.child || entry.status !== 'running' || !entry.child.stdin || !entry.child.stdin.writable) {
    return { ok: false, error: "Serveur non actif." };
  }
  entry.child.stdin.write(command.endsWith('\n') ? command : `${command}\n`);
  return { ok: true };
}

module.exports = { setBroadcaster, startProcess, stopProcess, forceStop, sendCommand, getState, isRunning, isAnyRunningWithPrefix };
