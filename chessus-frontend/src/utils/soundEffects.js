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
    this.currentSound = null;
    this.currentStopTimer = null;

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

    // Re-prime audio when tab becomes visible again (browser may suspend audio in background)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.unlocked) {
        Object.values(this.sounds).forEach(sound => {
          sound.load();
        });
      }
    });
  }

  play(soundName) {
    if (!this.enabled || !this.sounds[soundName]) return;

    try {
      // Stop any currently playing sound to prevent overlap/throttling
      if (this.currentSound) {
        try {
          this.currentSound.pause();
          this.currentSound.currentTime = 0;
        } catch (e) { /* ignore */ }
      }
      if (this.currentStopTimer) {
        clearTimeout(this.currentStopTimer);
        this.currentStopTimer = null;
      }

      const source = this.sounds[soundName];
      // Clone the audio node so the unlock prime cycle can't interfere
      const sound = source.cloneNode();
      sound.volume = source.volume;
      this.currentSound = sound;

      // Per-sound duration: move 0.25s, check 0.3s, everything else 0.6s
      const duration = soundName === 'move' ? 250 : soundName === 'check' ? 300 : 600;

      sound.play().then(() => {
        // Only set timer if this sound is still the active one
        if (this.currentSound !== sound) return;
        this.currentStopTimer = setTimeout(() => {
          sound.pause();
          if (this.currentSound === sound) {
            this.currentSound = null;
            this.currentStopTimer = null;
          }
        }, duration);
      }).catch(err => {
        if (this.currentSound === sound) {
          this.currentSound = null;
          this.currentStopTimer = null;
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
