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

// Truly lazy-load TensorFlow — only load when first image needs classification
// This avoids the ~10s TensorFlow native module load blocking server startup
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
    
    // SVG files can't be classified by the NSFW model (it expects a raster
    // tensor), but we can do a static analysis of the SVG markup itself:
    //  - Reject anything with active content (scripts, event handlers, foreignObject,
    //    iframes, javascript: URLs) — those are XSS vectors anyway
    //  - Queue anything with embedded raster data or external image refs, since
    //    those could hide NSFW content the static scan can't see
    //  - Auto-approve plain shape/path-only SVGs
    if (filePath.toLowerCase().endsWith('.svg')) {
      return scanSvg(filePath);
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

/**
 * Static analysis of an SVG file. SVGs are XML markup — we can't run them
 * through the NSFW image classifier, but we can scan the source for:
 *   - Active content / XSS vectors → REJECT (these are dangerous regardless
 *     of NSFW concerns and should never be served back to the browser)
 *   - Embedded raster images or external image refs → PENDING (could hide
 *     NSFW pixel data the static scan can't see)
 *   - Otherwise (only plain SVG primitives) → APPROVE
 *
 * @param {string} filePath - Absolute path to .svg file
 * @returns {{ status, predictions: null, reason }}
 */
function scanSvg(filePath) {
  const fs = require('fs');
  let svg;
  try {
    svg = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    return { status: 'pending_review', predictions: null, reason: `Could not read SVG: ${err.message}` };
  }

  // Sanity cap — anything wildly large is suspicious. Real piece SVGs are < 200KB.
  if (svg.length > 1024 * 1024) {
    return { status: 'pending_review', predictions: null, reason: 'SVG is unusually large — queued for manual review' };
  }

  const lower = svg.toLowerCase();

  // Hard-reject: XSS / active content. These have no place in a piece SVG and
  // would be a security risk to serve back, so we reject outright.
  const dangerousPatterns = [
    { re: /<script[\s>]/, name: '<script> tag' },
    { re: /<iframe[\s>]/, name: '<iframe> tag' },
    { re: /<foreignobject[\s>]/, name: '<foreignObject> tag' },
    { re: /\son[a-z]+\s*=/, name: 'inline event handler (on*=)' },
    { re: /javascript\s*:/, name: 'javascript: URL' },
    { re: /<!entity/, name: 'XML entity declaration' },
  ];
  for (const { re, name } of dangerousPatterns) {
    if (re.test(lower)) {
      return {
        status: 'rejected',
        predictions: null,
        reason: `SVG rejected: contains ${name} (potential XSS / active content)`
      };
    }
  }

  // Soft-queue: embedded or external raster image data could hide content
  // that this text scan cannot inspect.
  const suspiciousPatterns = [
    { re: /data:image\/(png|jpe?g|gif|webp|bmp)/, name: 'embedded raster image data' },
    { re: /<image[^>]*\b(href|xlink:href)\s*=\s*["']?https?:/, name: 'external image reference' },
    { re: /<use[^>]*\b(href|xlink:href)\s*=\s*["']?https?:/, name: 'external <use> reference' },
  ];
  for (const { re, name } of suspiciousPatterns) {
    if (re.test(lower)) {
      return {
        status: 'pending_review',
        predictions: null,
        reason: `SVG queued for manual review: contains ${name}`
      };
    }
  }

  return {
    status: 'approved',
    predictions: null,
    reason: 'SVG passed static analysis (shape primitives only, no scripts or embedded raster data)'
  };
}

module.exports = {
  classifyImage,
  classifyImages,
  isModelReady,
  initialize,
  scanSvg,
  THRESHOLDS
};
