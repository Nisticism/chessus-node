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
    // Queue of sound names requested while the tab was hidden / audio was not
    // yet unlocked. Drained on tab focus / first user interaction.
    this.pendingSounds = [];

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
        // Play any sound that was missed while the tab was hidden.
        // Small delay lets the priming settle before the real playback attempt.
        if (this.pendingSounds.length > 0) {
          const queued = this.pendingSounds.splice(0, this.pendingSounds.length);
          queued.forEach((name, idx) => setTimeout(() => this.play(name), 80 + idx * 60));
        }
      }
    });
  }

  play(soundName) {
    if (!this.enabled || !this.sounds[soundName]) return;

    // Audio hasn't been unlocked yet by a user interaction — queue the sound
    // so it fires as soon as the first click/key/touch unlocks the context.
    if (!this.unlocked) {
      if (this.pendingSounds.length < 8) this.pendingSounds.push(soundName);
      return;
    }

    try {
      // Hard cap: if we already have too many concurrent sounds the browser will
      // start silently rejecting play() calls. Stop the oldest clone first.
      // Raised from 4 -> 8 so a burst (move + capture + check + hit + bot reply)
      // doesn't silently drop later sounds.
      if (this.activeSounds.size >= 8) {
        const oldest = this.activeSounds.values().next().value;
        try { oldest.pause(); } catch (e) { /* ignore */ }
        this.activeSounds.delete(oldest);
      }

      const source = this.sounds[soundName];
      // Clone the audio node so the source element stays pristine for future clones.
      const sound = source.cloneNode();
      sound.volume = source.volume;

      this.activeSounds.add(sound);

      const cleanup = () => {
        this.activeSounds.delete(sound);
      };

      // Clip each sound to a fixed duration so every play sounds identical.
      // The timer is started the instant playback actually begins (the play()
      // promise resolves) and measured in wall-clock time, so the clip length is
      // consistent. The old approach compared sound.currentTime inside timeupdate
      // events, which fire only ~every 150-250ms — that made the clip stop up to
      // a quarter-second late and bleed into a WAV's second sample.
      // Durations: move 0.25s, check 0.3s, everything else 0.6s.
      const clipSec = soundName === 'move' ? 0.25 : soundName === 'check' ? 0.3 : 0.6;
      let clipFired = false;
      let clipTimer = null;
      let safetyTimer = null;

      const stopAndClean = () => {
        if (clipFired) return;
        clipFired = true;
        if (clipTimer) { clearTimeout(clipTimer); clipTimer = null; }
        if (safetyTimer) { clearTimeout(safetyTimer); safetyTimer = null; }
        try { sound.pause(); } catch (e) { /* ignore */ }
        cleanup();
      };

      sound.addEventListener('ended', stopAndClean, { once: true });
      sound.addEventListener('error', stopAndClean, { once: true });
      // Backstop: clean up if the play() promise never settles for a stalled clone.
      safetyTimer = setTimeout(stopAndClean, 2000);

      sound.play().then(() => {
        // Playback has started — schedule the precise stop. setTimeout resolution
        // (a few ms) is far tighter than timeupdate's ~250ms, so the clip plays
        // for the same length every time.
        if (!clipFired) {
          clipTimer = setTimeout(stopAndClean, clipSec * 1000);
        }
      }).catch(err => {
        stopAndClean();
        // If the tab was hidden, store for replay on next turn start
        if (document.visibilityState === 'hidden') {
          if (this.pendingSounds.length < 8) this.pendingSounds.push(soundName);
        }
        console.debug('Sound play prevented:', err.message);
      });
    } catch (err) {
      console.debug('Error playing sound:', err);
    }
  }

  playMove() {
    this.play('move');
  }

  onTurnStart() {
    if (this.pendingSounds.length > 0) {
      const queued = this.pendingSounds.splice(0, this.pendingSounds.length);
      queued.forEach((name, idx) => setTimeout(() => this.play(name), 80 + idx * 60));
    }
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
