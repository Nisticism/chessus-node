// Sound effects utility for game actions

// Import sound files
import moveSound from '../assets/sounds/game/move.wav';
import captureSound from '../assets/sounds/game/capture.wav';
import checkSound from '../assets/sounds/game/check.wav';
import checkmateSound from '../assets/sounds/game/checkmate.wav';
import gameStartSound from '../assets/sounds/game/gameStart.wav';
import illegalMoveSound from '../assets/sounds/game/illegalMove.wav';
import hitSound from '../assets/sounds/game/hit.wav';

class SoundManager {
  constructor() {
    this.sounds = {
      move: new Audio(moveSound),
      capture: new Audio(captureSound),
      check: new Audio(checkSound),
      checkmate: new Audio(checkmateSound),
      gameStart: new Audio(gameStartSound),
      illegalMove: new Audio(illegalMoveSound),
      hit: new Audio(hitSound)
    };

    // Set default volume
    Object.values(this.sounds).forEach(sound => {
      sound.volume = 0.5;
      sound.preload = 'auto';
    });

    this.enabled = true;
    this.unlocked = false;
    // Set of currently-playing clones; capped to prevent browser audio-channel exhaustion.
    this.activeSounds = new Set();

    // Unlock audio on first user interaction (bypasses browser autoplay policy)
    const unlock = () => {
      if (this.unlocked) return;
      this.unlocked = true;
      // Prime audio by playing silent clones (not the sources themselves,
      // so source elements are never left in a playing state when a real play() clones them)
      Object.values(this.sounds).forEach(sound => {
        const primer = sound.cloneNode();
        primer.volume = 0;
        primer.play().then(() => {
          primer.pause();
        }).catch(() => {});
      });
      document.removeEventListener('click', unlock);
      document.removeEventListener('keydown', unlock);
      document.removeEventListener('touchstart', unlock);
    };

    document.addEventListener('click', unlock, { once: false });
    document.addEventListener('keydown', unlock, { once: false });
    document.addEventListener('touchstart', unlock, { once: false });

    // Re-prime audio when tab becomes visible again (browser may suspend audio context).
    // Do NOT call sound.load() here — it resets the media element's load state and any
    // subsequent cloneNode() will clone an element mid-reload, causing delayed playback.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && !this.unlocked) {
        // Page was never interacted with while in background; no action needed.
        return;
      }
      if (document.visibilityState === 'visible') {
        // Re-run the silent priming pass so the browser's audio context is warm.
        Object.values(this.sounds).forEach(sound => {
          const primer = sound.cloneNode();
          primer.volume = 0;
          primer.play().then(() => { primer.pause(); }).catch(() => {});
        });
      }
    });
  }

  play(soundName) {
    if (!this.enabled || !this.sounds[soundName]) return;

    try {
      // Hard cap: if we already have too many concurrent sounds the browser will
      // start silently rejecting play() calls. Stop the oldest clone first.
      if (this.activeSounds.size >= 4) {
        const oldest = this.activeSounds.values().next().value;
        try { oldest.pause(); } catch (e) { /* ignore */ }
        this.activeSounds.delete(oldest);
      }

      const source = this.sounds[soundName];
      // Clone the audio node so the source element stays pristine for future clones.
      const sound = source.cloneNode();
      sound.volume = source.volume;

      // Per-sound clip duration: move 0.25s, check 0.3s, everything else 0.6s.
      const duration = soundName === 'move' ? 250 : soundName === 'check' ? 300 : 600;

      // Schedule the clip timer SYNCHRONOUSLY before play() — never inside .then().
      // The old code set the timer inside .then(), which could be skipped if a
      // second sound started before the first Promise resolved, leaving orphan clones.
      const stopTimer = setTimeout(() => {
        try { sound.pause(); } catch (e) { /* ignore */ }
        this.activeSounds.delete(sound);
      }, duration);

      const onDone = () => {
        clearTimeout(stopTimer);
        this.activeSounds.delete(sound);
      };
      sound.addEventListener('ended', onDone, { once: true });
      sound.addEventListener('error', onDone, { once: true });
      this.activeSounds.add(sound);

      sound.play().catch(err => {
        clearTimeout(stopTimer);
        onDone();
        console.debug('Sound play prevented:', err.message);
      });
    } catch (err) {
      console.debug('Error playing sound:', err);
    }
  }

  playMove() {
    this.play('move');
  }

  playCapture() {
    this.play('capture');
  }

  playCheck() {
    this.play('check');
  }

  playCheckmate() {
    this.play('checkmate');
  }

  playGameStart() {
    this.play('gameStart');
  }

  playIllegalMove() {
    this.play('illegalMove');
  }

  playHit() {
    this.play('hit');
  }

  setVolume(volume) {
    // volume should be between 0 and 1
    const clampedVolume = Math.max(0, Math.min(1, volume));
    Object.values(this.sounds).forEach(sound => {
      sound.volume = clampedVolume;
    });
  }

  toggle() {
    this.enabled = !this.enabled;
    return this.enabled;
  }

  enable() {
    this.enabled = true;
  }

  disable() {
    this.enabled = false;
  }

  isEnabled() {
    return this.enabled;
  }
}

// Create singleton instance
const soundManager = new SoundManager();

export default soundManager;
