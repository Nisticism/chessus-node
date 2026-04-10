/**
 * Image moderation using nsfwjs (TensorFlow.js) for NSFW detection.
 * Classifies images into categories: Drawing, Hentai, Neutral, Porn, Sexy.
 * 
 * Decision thresholds:
 * - Auto-approve:  Porn < 0.10 AND Hentai < 0.10 AND Sexy < 0.20
 * - Auto-reject:   Porn >= 0.60 OR Hentai >= 0.60
 * - Queue for review: everything in between
 */

let tf;
let nsfwjs;
let model = null;
let modelLoading = false;
let modelReady = false;

// Lazy-load TensorFlow to avoid slowing down server startup
async function loadModel() {
  if (model) return model;
  if (modelLoading) {
    // Wait for existing load to complete
    while (modelLoading) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return model;
  }

  modelLoading = true;
  try {
    tf = require('@tensorflow/tfjs-node');
    nsfwjs = require('nsfwjs');
    // Use the default model (MobileNetV2 mid — good balance of speed/accuracy)
    model = await nsfwjs.load();
    modelReady = true;
    console.log('NSFW image moderation model loaded successfully');
    return model;
  } catch (err) {
    console.error('Failed to load NSFW model:', err.message);
    console.error('Image moderation will queue all uploads for manual review.');
    modelLoading = false;
    return null;
  } finally {
    modelLoading = false;
  }
}

// Thresholds
const THRESHOLDS = {
  // Auto-reject if any of these are exceeded
  REJECT_PORN: 0.60,
  REJECT_HENTAI: 0.60,
  // Auto-approve only if ALL of these are below threshold
  APPROVE_PORN: 0.10,
  APPROVE_HENTAI: 0.10,
  APPROVE_SEXY: 0.20,
};

/**
 * Classify a single image file.
 * @param {string} filePath - Absolute path to the image file
 * @returns {{ status: 'approved'|'rejected'|'pending_review', predictions: object, reason: string }}
 */
async function classifyImage(filePath) {
  const fs = require('fs');
  
  // If model isn't available, queue for manual review
  const nsfwModel = await loadModel();
  if (!nsfwModel) {
    return {
      status: 'pending_review',
      predictions: null,
      reason: 'NSFW model not available — queued for manual review'
    };
  }

  try {
    // Read image as buffer and decode
    const imageBuffer = fs.readFileSync(filePath);
    
    // SVG files can't be classified by the model — skip them
    if (filePath.toLowerCase().endsWith('.svg')) {
      return {
        status: 'pending_review',
        predictions: null,
        reason: 'SVG images cannot be auto-scanned — queued for manual review'
      };
    }

    // Decode the image to a tensor
    let imageTensor;
    try {
      imageTensor = tf.node.decodeImage(imageBuffer, 3);
    } catch (decodeErr) {
      return {
        status: 'pending_review',
        predictions: null,
        reason: `Could not decode image: ${decodeErr.message}`
      };
    }

    // Run classification
    const predictions = await nsfwModel.classify(imageTensor);
    // Clean up tensor to prevent memory leak
    imageTensor.dispose();

    // Convert predictions array to object for easier access
    const scores = {};
    predictions.forEach(p => {
      scores[p.className] = p.probability;
    });

    const porn = scores['Porn'] || 0;
    const hentai = scores['Hentai'] || 0;
    const sexy = scores['Sexy'] || 0;

    // Decision logic
    if (porn >= THRESHOLDS.REJECT_PORN || hentai >= THRESHOLDS.REJECT_HENTAI) {
      return {
        status: 'rejected',
        predictions: scores,
        reason: `Image classified as inappropriate (Porn: ${(porn * 100).toFixed(1)}%, Hentai: ${(hentai * 100).toFixed(1)}%)`
      };
    }

    if (porn < THRESHOLDS.APPROVE_PORN && hentai < THRESHOLDS.APPROVE_HENTAI && sexy < THRESHOLDS.APPROVE_SEXY) {
      return {
        status: 'approved',
        predictions: scores,
        reason: 'Image passed automated NSFW check'
      };
    }

    // Borderline — queue for review
    return {
      status: 'pending_review',
      predictions: scores,
      reason: `Borderline scores — queued for review (Porn: ${(porn * 100).toFixed(1)}%, Hentai: ${(hentai * 100).toFixed(1)}%, Sexy: ${(sexy * 100).toFixed(1)}%)`
    };
  } catch (err) {
    console.error('Error classifying image:', err.message);
    return {
      status: 'pending_review',
      predictions: null,
      reason: `Classification error: ${err.message}`
    };
  }
}

/**
 * Classify multiple image files. Returns per-file results and an overall decision.
 * Overall: rejected if ANY image rejected, pending_review if ANY pending, otherwise approved.
 * @param {string[]} filePaths - Array of absolute file paths
 * @returns {{ overall: string, results: Array }}
 */
async function classifyImages(filePaths) {
  const results = [];
  
  for (const filePath of filePaths) {
    const result = await classifyImage(filePath);
    results.push({ filePath, ...result });
  }
  
  // Determine overall status
  const hasRejected = results.some(r => r.status === 'rejected');
  const hasPending = results.some(r => r.status === 'pending_review');
  
  let overall = 'approved';
  if (hasRejected) overall = 'rejected';
  else if (hasPending) overall = 'pending_review';
  
  return { overall, results };
}

/**
 * Check if the model is ready (loaded).
 */
function isModelReady() {
  return modelReady;
}

/**
 * Pre-load the model (call during server startup for faster first scan).
 */
async function initialize() {
  try {
    await loadModel();
  } catch (err) {
    console.error('Image moderation initialization failed:', err.message);
  }
}

module.exports = {
  classifyImage,
  classifyImages,
  isModelReady,
  initialize,
  THRESHOLDS
};
