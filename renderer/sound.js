'use strict';

// Bruitages de l'interface, entièrement synthétisés via Web Audio API : pas de
// fichier .mp3/.wav à embarquer, pas de question de droits, poids nul.
(function () {
  let audioCtx = null;
  let noiseBuffer = null;

  function getContext() {
    if (!audioCtx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return null;
      audioCtx = new Ctor();
    }
    if (audioCtx.state === 'suspended') {
      // Les navigateurs (Chromium inclus) suspendent l'audio tant qu'aucune
      // interaction utilisateur n'a eu lieu : on retente à chaque son joué,
      // ça se débloque tout seul dès la première touche/clic.
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  }

  // Buffer de bruit blanc généré une seule fois et réutilisé pour tous les
  // transitoires "clic"/"tock" (évite de le recalculer à chaque son joué).
  function getNoiseBuffer(ctx) {
    if (noiseBuffer && noiseBuffer.sampleRate === ctx.sampleRate) return noiseBuffer;
    const length = Math.floor(ctx.sampleRate * 0.15);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    noiseBuffer = buffer;
    return buffer;
  }

  function playTone({ startFreq, endFreq = startFreq, duration = 0.08, type = 'sine', volume = 0.15, delay = 0, filterFreq = null }) {
    const ctx = getContext();
    if (!ctx) return;

    try {
      const startTime = ctx.currentTime + delay;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(startFreq, startTime);
      if (endFreq !== startFreq) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(endFreq, 1), startTime + duration);
      }

      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(volume, startTime + 0.008); // léger fondu d'entrée, évite le "clic" numérique
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

      let lastNode = osc;
      if (filterFreq) {
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = filterFreq;
        lastNode.connect(filter);
        lastNode = filter;
      }

      lastNode.connect(gain);
      gain.connect(ctx.destination);

      osc.start(startTime);
      osc.stop(startTime + duration + 0.02);
    } catch (e) {
      // Web Audio indisponible/bloqué : on ignore silencieusement, l'appli reste utilisable.
    }
  }

  // Transitoire de bruit filtré : donne le petit "clic"/"tick" percussif propre
  // aux interfaces modernes, en complément d'une tonalité pure.
  function playNoiseBurst({ duration = 0.03, volume = 0.1, filterFreq = 3000, filterType = 'bandpass', delay = 0 }) {
    const ctx = getContext();
    if (!ctx) return;

    try {
      const startTime = ctx.currentTime + delay;
      const source = ctx.createBufferSource();
      source.buffer = getNoiseBuffer(ctx);

      const filter = ctx.createBiquadFilter();
      filter.type = filterType;
      filter.frequency.value = filterFreq;
      filter.Q.value = 1.2;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(volume, startTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

      source.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      source.start(startTime);
      source.stop(startTime + duration + 0.02);
    } catch (e) {
      // idem : on ignore silencieusement en cas de problème
    }
  }

  window.GameSounds = {
    // Déplacement de la sélection dans la grille (clavier, manette, souris) :
    // un tick filtré très bref + une pointe de fréquence haute, net et discret.
    navigate() {
      playNoiseBurst({ duration: 0.02, volume: 0.09, filterFreq: 4200, filterType: 'bandpass' });
      playTone({ startFreq: 1400, endFreq: 900, duration: 0.035, type: 'sine', volume: 0.05, filterFreq: 6000 });
    },

    // Lancement d'un jeu : petit arpège montant à deux notes avec filtre, plus
    // franc et "premium" qu'une simple tonalité qui glisse.
    confirm() {
      playNoiseBurst({ duration: 0.02, volume: 0.08, filterFreq: 5000 });
      playTone({ startFreq: 523, duration: 0.09, type: 'triangle', volume: 0.16, filterFreq: 4000 });
      playTone({ startFreq: 784, duration: 0.14, type: 'triangle', volume: 0.16, filterFreq: 4500, delay: 0.05 });
    },

    // Retour / réduction dans la zone de notification : tonalité descendante
    // douce, moins agressive qu'un simple "beep" inversé.
    back() {
      playTone({ startFreq: 600, endFreq: 260, duration: 0.16, type: 'sine', volume: 0.14, filterFreq: 3000 });
      playNoiseBurst({ duration: 0.025, volume: 0.06, filterFreq: 800, filterType: 'lowpass', delay: 0.02 });
    },

    // Ouverture/fermeture de panneaux, clics de boutons secondaires : un "tock"
    // sourd et sec, sans hauteur tonale marquée (comme un clic de souris haut de gamme).
    toggle() {
      playNoiseBurst({ duration: 0.025, volume: 0.11, filterFreq: 1800, filterType: 'bandpass' });
      playTone({ startFreq: 300, duration: 0.03, type: 'sine', volume: 0.05, filterFreq: 1200 });
    },
  };
})();
