// Sound effects utility for game actions

// Import sound files
import moveSound from '../assets/sounds/game/move.wav';
import captureSound from '../assets/sounds/game/capture.wav';
import checkSound from '../assets/sounds/check.wav';
import checkmateSound from '../assets/sounds/game/checkmate.wav';
import gameStartSound from '../assets/sounds/game/gameStart.wav';
import premoveSound from '../assets/sounds/game/premove.wav';
import illegalMoveSound from '../assets/sounds/game/illegalMove.wav';

class SoundManager {
  constructor() {
    this.sounds = {
      move: new Audio(moveSound),
      capture: new Audio(captureSound),
      check: new Audio(checkSound),
      checkmate: new Audio(checkmateSound),
      gameStart: new Audio(gameStartSound),
      premove: new Audio(premoveSound),
      illegalMove: new Audio(illegalMoveSound)
    };

    // Set default volume
    Object.values(this.sounds).forEach(sound => {
      sound.volume = 0.5;
    });

    this.enabled = true;
  }

  play(soundName) {
    if (!this.enabled || !this.sounds[soundName]) return;

    try {
      const sound = this.sounds[soundName];
      // Stop any currently playing instance and reset
      sound.pause();
      sound.currentTime = 0;

      // Stop playback after 0.5 seconds
      const stopTimer = setTimeout(() => {
        sound.pause();
      }, 500);

      sound.play().catch(err => {
        clearTimeout(stopTimer);
        // Ignore errors (e.g., user hasn't interacted with page yet)
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

  playPremove() {
    this.play('premove');
  }

  playIllegalMove() {
    this.play('illegalMove');
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
