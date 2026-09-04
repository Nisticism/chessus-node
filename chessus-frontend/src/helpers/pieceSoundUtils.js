/**
 * Client-side audio prep for custom piece sounds.
 *
 * Everything is normalised to a short WAV before upload:
 *   - the browser decodes whatever the user picked (mp3/ogg/wav/m4a/...),
 *   - we measure the real duration and, if it's too long, crop to the first
 *     PIECE_SOUND_MAX_SECONDS once the user confirms,
 *   - we re-encode to 16-bit PCM WAV.
 *
 * Doing it here means the server can read the duration straight from the WAV
 * header instead of shipping an audio-decoding dependency, and the user finds
 * out a clip is too long before spending an upload on it.
 */

export const PIECE_SOUND_MAX_SECONDS = 1.5;

// Slots correspond to the piece-action sounds the game plays. Check and
// checkmate are deliberately absent: those stay as site sounds and are layered
// over a custom sound rather than replaced by it.
export const PIECE_SOUND_SLOTS = [
  {
    key: 'move',
    column: 'move_sound_url',
    label: 'Move',
    hint: 'Plays when this piece moves to an empty square.',
  },
  {
    key: 'capture',
    column: 'capture_sound_url',
    label: 'Capture',
    hint: 'Plays when this piece captures another piece.',
  },
  {
    key: 'hit',
    column: 'hit_sound_url',
    label: 'Hit (damage without a kill)',
    hint: 'Plays when this piece damages a piece that survives, in games using hit points and attack damage.',
  },
];

let sharedContext = null;
const getAudioContext = () => {
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  if (!sharedContext) sharedContext = new Ctor();
  return sharedContext;
};

/** Decode a picked file into an AudioBuffer. Throws a user-facing Error. */
export const decodeAudioFile = async (file) => {
  const ctx = getAudioContext();
  if (!ctx) throw new Error("This browser can't read audio files.");
  const bytes = await file.arrayBuffer();
  try {
    // Safari still wants the callback form, so wrap rather than await directly.
    return await new Promise((resolve, reject) => {
      ctx.decodeAudioData(bytes, resolve, () => reject(new Error('decode failed')));
    });
  } catch {
    throw new Error("That file couldn't be read as audio. Try a WAV, MP3, or OGG file.");
  }
};

/** Copy the first `seconds` of a buffer (or the whole thing if it's shorter). */
const cropBuffer = (buffer, seconds) => {
  const frames = Math.min(buffer.length, Math.floor(buffer.sampleRate * seconds));
  const ctx = getAudioContext();
  const out = ctx.createBuffer(buffer.numberOfChannels, frames, buffer.sampleRate);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    out.getChannelData(ch).set(buffer.getChannelData(ch).subarray(0, frames));
  }
  return out;
};

/** Encode an AudioBuffer as a 16-bit PCM WAV blob. */
const encodeWav = (buffer) => {
  const channels = Math.min(buffer.numberOfChannels, 2);
  const frames = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const dataBytes = frames * blockAlign;
  const view = new DataView(new ArrayBuffer(44 + dataBytes));

  const writeAscii = (offset, text) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);            // PCM chunk size
  view.setUint16(20, 1, true);             // format: PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * blockAlign, true); // byte rate
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 8 * bytesPerSample, true);
  writeAscii(36, 'data');
  view.setUint32(40, dataBytes, true);

  const channelData = [];
  for (let ch = 0; ch < channels; ch++) channelData.push(buffer.getChannelData(ch));

  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (let ch = 0; ch < channels; ch++) {
      const sample = Math.max(-1, Math.min(1, channelData[ch][i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([view], { type: 'audio/wav' });
};

/**
 * Prepare a picked file for upload.
 * Returns { blob, duration, wasCropped, originalDuration }.
 * Pass allowCrop=false first to find out whether it's too long; if the user
 * agrees to trim it, call again with allowCrop=true.
 */
export const preparePieceSound = async (file, { allowCrop = false } = {}) => {
  const buffer = await decodeAudioFile(file);
  const originalDuration = buffer.duration;
  const tooLong = originalDuration > PIECE_SOUND_MAX_SECONDS + 0.01;

  if (tooLong && !allowCrop) {
    const err = new Error('too-long');
    err.code = 'TOO_LONG';
    err.originalDuration = originalDuration;
    throw err;
  }

  const finalBuffer = tooLong ? cropBuffer(buffer, PIECE_SOUND_MAX_SECONDS) : buffer;
  return {
    blob: encodeWav(finalBuffer),
    duration: finalBuffer.duration,
    wasCropped: tooLong,
    originalDuration,
  };
};

/** Whether this user may use custom piece sounds (Silver supporter and above). */
export const canUseCustomSounds = (user) => {
  if (!user) return false;
  const role = (user.role || '').toLowerCase();
  if (role === 'admin' || role === 'owner') return true;
  return parseFloat(user.total_donations || 0) >= 5;
};
