/**
 * Image processing module
 * Handles image preprocessing, postprocessing, and composition
 */

import { CONFIG } from './config.js';
import { calculateWatermarkRegion } from './utils.js';

/**
 * Preprocess image for model input
 * @param {ImageData} imageData - The input image data
 * @returns {Object} - { imageTensor, maskTensor }
 */
export function preprocessImage(imageData) {
  const { width, height, data } = imageData;
  
  // Create image tensor (1, 3, H, W) - CHW format
  const float32Data = new Float32Array(3 * width * height);
  
  // Normalize RGB values from [0, 255] to [0, 1] and convert HWC to CHW
  for (let i = 0; i < width * height; i++) {
    float32Data[i] = data[i * 4] / 255.0;                          // R channel
    float32Data[width * height + i] = data[i * 4 + 1] / 255.0;    // G channel
    float32Data[2 * width * height + i] = data[i * 4 + 2] / 255.0; // B channel
  }
  
  const imageTensor = new ort.Tensor('float32', float32Data, [1, 3, height, width]);
  
  // Create mask tensor (1, 1, H, W)
  const maskData = new Float32Array(width * height);
  const region = calculateWatermarkRegion(width, height);
  
  // Set mask: 1.0 for watermark region, 0.0 for rest
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      // Check if pixel is in watermark region (bottom-right corner)
      if (y >= region.y && x >= region.x) {
        maskData[idx] = 1.0;  // Mark for inpainting
      } else {
        maskData[idx] = 0.0;  // Preserve original
      }
    }
  }
  
  const maskTensor = new ort.Tensor('float32', maskData, [1, 1, height, width]);
  
  return { imageTensor, maskTensor };
}

/**
 * Postprocess model output to ImageData
 * @param {Tensor} outputTensor - The model output tensor
 * @param {number} width - Output width
 * @param {number} height - Output height
 * @returns {ImageData} - The processed image data
 */
export function postprocessImage(outputTensor, width, height) {
  const data = outputTensor.data;
  const rgbaData = new Uint8ClampedArray(width * height * 4);
  
  // Auto-detect value range (0-1 or 0-255)
  let maxVal = 0;
  const sampleSize = Math.min(1000, data.length / 3);
  for (let i = 0; i < sampleSize; i++) {
    maxVal = Math.max(maxVal, Math.abs(data[i]));
  }
  const isNormalized = maxVal <= 2.0;  // If max <= 2, assume normalized [0, 1]
  
  // Convert CHW to HWC and denormalize if needed
  for (let i = 0; i < width * height; i++) {
    let r = data[i];
    let g = data[width * height + i];
    let b = data[2 * width * height + i];
    
    if (isNormalized) {
      r *= 255;
      g *= 255;
      b *= 255;
    }
    
    // Clamp values to [0, 255]
    rgbaData[i * 4] = Math.min(255, Math.max(0, Math.round(r)));
    rgbaData[i * 4 + 1] = Math.min(255, Math.max(0, Math.round(g)));
    rgbaData[i * 4 + 2] = Math.min(255, Math.max(0, Math.round(b)));
    rgbaData[i * 4 + 3] = 255;  // Alpha channel
  }
  
  return new ImageData(rgbaData, width, height);
}

/**
 * Compose final image by blending original and processed regions
 * Strategy: Alpha blend with feathered edges for smooth transition
 * 
 * @param {ImageBitmap} originalBitmap - Original full-resolution image
 * @param {ImageData} processedImageData - Processed 512x512 image data
 * @param {number} featherSize - Override feather size (optional, uses config default)
 * @returns {string} - Data URL of the final composed image
 */
export function composeFinalImage(originalBitmap, processedImageData, featherSize = null) {
  const { width: origWidth, height: origHeight } = originalBitmap;
  const processedSize = CONFIG.MODEL.INPUT_SIZE;
  const feather = featherSize !== null ? featherSize : CONFIG.WATERMARK.FEATHER_SIZE;
  
  // Create final canvas at original resolution
  const finalCanvas = document.createElement('canvas');
  finalCanvas.width = origWidth;
  finalCanvas.height = origHeight;
  const finalCtx = finalCanvas.getContext('2d');
  
  // Draw original image as base
  finalCtx.drawImage(originalBitmap, 0, 0);
  
  // Get original image data for the watermark region (with feather padding)
  const origRegion = calculateWatermarkRegion(
    origWidth, 
    origHeight, 
    CONFIG.WATERMARK.EXTENDED_RATIO
  );
  
  // Expand region to include feather zone
  const expandedX = Math.max(0, origRegion.x - feather);
  const expandedY = Math.max(0, origRegion.y - feather);
  const expandedWidth = Math.min(origWidth - expandedX, origRegion.width + feather);
  const expandedHeight = Math.min(origHeight - expandedY, origRegion.height + feather);
  
  // Create temporary canvas for processed image scaled to original region size
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = expandedWidth;
  tempCanvas.height = expandedHeight;
  const tempCtx = tempCanvas.getContext('2d');
  
  // Calculate source region from processed image
  const processedRegion = calculateWatermarkRegion(
    processedSize, 
    processedSize, 
    CONFIG.WATERMARK.EXTENDED_RATIO
  );
  
  // Scale factor for feather in processed space
  const scaleX = processedRegion.width / origRegion.width;
  const scaleY = processedRegion.height / origRegion.height;
  const processedFeatherX = Math.floor(feather * scaleX);
  const processedFeatherY = Math.floor(feather * scaleY);
  
  // Expanded processed region
  const procExpandedX = Math.max(0, processedRegion.x - processedFeatherX);
  const procExpandedY = Math.max(0, processedRegion.y - processedFeatherY);
  const procExpandedWidth = Math.min(processedSize - procExpandedX, processedRegion.width + processedFeatherX);
  const procExpandedHeight = Math.min(processedSize - procExpandedY, processedRegion.height + processedFeatherY);
  
  // Put processed image data into a canvas for scaling
  const procCanvas = document.createElement('canvas');
  procCanvas.width = processedSize;
  procCanvas.height = processedSize;
  const procCtx = procCanvas.getContext('2d');
  procCtx.putImageData(processedImageData, 0, 0);
  
  // Draw scaled processed region to temp canvas
  tempCtx.drawImage(
    procCanvas,
    procExpandedX, procExpandedY, procExpandedWidth, procExpandedHeight,
    0, 0, expandedWidth, expandedHeight
  );
  
  // Get pixel data for blending
  const originalImageData = finalCtx.getImageData(expandedX, expandedY, expandedWidth, expandedHeight);
  const processedScaledData = tempCtx.getImageData(0, 0, expandedWidth, expandedHeight);
  
  // Create feathered blend
  const blendedData = createFeatheredBlend(
    originalImageData,
    processedScaledData,
    expandedWidth,
    expandedHeight,
    feather,
    origRegion.x - expandedX,  // Offset to core region
    origRegion.y - expandedY
  );
  
  // Put blended result back
  finalCtx.putImageData(blendedData, expandedX, expandedY);
  
  // Convert to data URL
  return finalCanvas.toDataURL(CONFIG.IMAGE.OUTPUT_FORMAT, CONFIG.IMAGE.OUTPUT_QUALITY);
}

/**
 * Create feathered blend between original and processed image data
 * @param {ImageData} original - Original image data
 * @param {ImageData} processed - Processed image data
 * @param {number} width - Width of the region
 * @param {number} height - Height of the region
 * @param {number} featherSize - Size of feather zone in pixels
 * @param {number} coreOffsetX - X offset to core (non-feathered) region
 * @param {number} coreOffsetY - Y offset to core (non-feathered) region
 * @returns {ImageData} - Blended image data
 */
function createFeatheredBlend(original, processed, width, height, featherSize, coreOffsetX, coreOffsetY) {
  const result = new ImageData(width, height);
  const origData = original.data;
  const procData = processed.data;
  const resultData = result.data;
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      
      // Calculate distance from the core region edges
      const distFromCoreX = x < coreOffsetX ? coreOffsetX - x : 0;
      const distFromCoreY = y < coreOffsetY ? coreOffsetY - y : 0;
      const distFromCore = Math.sqrt(distFromCoreX * distFromCoreX + distFromCoreY * distFromCoreY);
      
      // Calculate blend alpha (0 = original, 1 = processed)
      let alpha;
      if (distFromCore <= 0) {
        // Inside core region - use processed
        alpha = 1.0;
      } else if (distFromCore >= featherSize) {
        // Outside feather zone - use original
        alpha = 0.0;
      } else {
        // In feather zone - smooth gradient using smoothstep
        const t = distFromCore / featherSize;
        // Smoothstep for natural transition: 3t² - 2t³
        alpha = 1.0 - (t * t * (3.0 - 2.0 * t));
      }
      
      // Blend RGB channels
      resultData[idx] = Math.round(origData[idx] * (1 - alpha) + procData[idx] * alpha);
      resultData[idx + 1] = Math.round(origData[idx + 1] * (1 - alpha) + procData[idx + 1] * alpha);
      resultData[idx + 2] = Math.round(origData[idx + 2] * (1 - alpha) + procData[idx + 2] * alpha);
      resultData[idx + 3] = 255;  // Full opacity
    }
  }
  
  return result;
}

/**
 * Resize image to model input size
 * @param {ImageBitmap} bitmap - The image to resize
 * @returns {ImageData} - Resized image data
 */
export function resizeImageForModel(bitmap) {
  const size = CONFIG.MODEL.INPUT_SIZE;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, size, size);
  return ctx.getImageData(0, 0, size, size);
}

/**
 * Create comparison image (side-by-side before/after)
 * @param {ImageBitmap} originalBitmap - Original image
 * @param {string} processedDataUrl - Processed image data URL
 * @returns {Promise<string>} - Data URL of comparison image
 */
export async function createComparisonImage(originalBitmap, processedDataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const width = originalBitmap.width;
      const height = originalBitmap.height;
      
      const canvas = document.createElement('canvas');
      canvas.width = width * 2 + 20;  // 20px gap
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      
      // White background
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      // Draw original (left)
      ctx.drawImage(originalBitmap, 0, 0);
      
      // Draw processed (right)
      ctx.drawImage(img, width + 20, 0);
      
      // Add labels
      ctx.fillStyle = '#000000';
      ctx.font = 'bold 20px Arial';
      ctx.fillText('Original', 10, 30);
      ctx.fillText('Cleaned', width + 30, 30);
      
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = reject;
    img.src = processedDataUrl;
  });
}
