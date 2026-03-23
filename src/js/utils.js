/**
 * Utility functions for image validation, logging, and helper operations
 */

import { CONFIG } from './config.js';

/**
 * Validate image file
 * @param {File} file - The file to validate
 * @returns {Object} - { valid: boolean, error: string|null }
 */
export function validateImageFile(file) {
  if (!file) {
    return { valid: false, error: 'No file provided' };
  }

  // Check file type
  if (!CONFIG.IMAGE.ALLOWED_TYPES.includes(file.type)) {
    return { valid: false, error: CONFIG.ERRORS.INVALID_FILE_TYPE };
  }

  // Check file size
  if (file.size > CONFIG.IMAGE.MAX_FILE_SIZE) {
    return { valid: false, error: CONFIG.ERRORS.FILE_TOO_LARGE };
  }

  return { valid: true, error: null };
}

/**
 * Format file size in human-readable format
 * @param {number} bytes - Size in bytes
 * @returns {string} - Formatted size (e.g., "2.5 MB")
 */
export function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Generate timestamp for file naming
 * @returns {string} - Timestamp string
 */
export function generateTimestamp() {
  return Date.now().toString();
}

/**
 * Debounce function to limit function calls
 * @param {Function} func - Function to debounce
 * @param {number} wait - Wait time in ms
 * @returns {Function} - Debounced function
 */
export function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Create a logger instance with UI integration
 * @param {HTMLElement} logElement - The log container element
 * @returns {Object} - Logger object with log methods
 */
export function createLogger(logElement) {
  const logs = [];
  
  const log = (message, level = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = { timestamp, message, level };
    logs.push(logEntry);
    
    // Keep only last N logs
    if (logs.length > CONFIG.UI.LOG_MAX_LINES) {
      logs.shift();
    }
    
    // Update UI
    if (logElement) {
      logElement.style.display = 'block';
      const line = document.createElement('div');
      line.className = `log-line log-${level}`;
      const timeSpan = document.createElement('span');
      timeSpan.className = 'log-time';
      timeSpan.textContent = `[${timestamp}]`;
      line.appendChild(timeSpan);
      line.appendChild(document.createTextNode(` ${message}`));
      logElement.appendChild(line);
      logElement.scrollTop = logElement.scrollHeight;
    }
    
    // Console output
    console[level === 'error' ? 'error' : 'log'](`[${timestamp}] ${message}`);
  };
  
  return {
    info: (msg) => log(msg, 'info'),
    warn: (msg) => log(msg, 'warn'),
    error: (msg) => log(msg, 'error'),
    clear: () => {
      logs.length = 0;
      if (logElement) {
        logElement.innerHTML = '';
        logElement.style.display = 'none';
      }
    },
    getLogs: () => [...logs]
  };
}

/**
 * Download data URL as file
 * @param {string} dataUrl - The data URL to download
 * @param {string} filename - The filename for download
 */
export function downloadDataUrl(dataUrl, filename) {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * Load image from File object
 * @param {File} file - The image file
 * @returns {Promise<ImageBitmap>} - The loaded image bitmap
 */
export async function loadImageFromFile(file) {
  return await createImageBitmap(file);
}

/**
 * Calculate watermark region coordinates
 * @param {number} width - Image width
 * @param {number} height - Image height
 * @param {number} ratio - Region ratio (default from config)
 * @returns {Object} - { x, y, width, height }
 */
export function calculateWatermarkRegion(width, height, ratio = null) {
  const heightRatio = ratio || CONFIG.WATERMARK.HEIGHT_RATIO;
  const widthRatio = ratio || CONFIG.WATERMARK.WIDTH_RATIO;
  
  const regionWidth = Math.floor(width * widthRatio);
  const regionHeight = Math.floor(height * heightRatio);
  const x = width - regionWidth;
  const y = height - regionHeight;
  
  return { x, y, width: regionWidth, height: regionHeight };
}

/**
 * Escape a string for safe insertion into HTML
 * @param {string} str - The untrusted string
 * @returns {string} - HTML-escaped string
 */
export function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Convert a canvas to a Blob object URL for better memory management.
 * Uses canvas.toBlob() which keeps binary data as-is, avoiding the ~33%
 * overhead of base64-encoded data URLs.
 * The caller is responsible for calling URL.revokeObjectURL() when done.
 * @param {HTMLCanvasElement} canvas - The canvas to convert
 * @param {string} [type='image/png'] - MIME type for the output image
 * @param {number} [quality] - Quality for lossy formats (0–1)
 * @returns {Promise<string>} - A blob: object URL
 */
export function canvasToObjectUrl(canvas, type = 'image/png', quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('canvas.toBlob() returned null'));
          return;
        }
        resolve(URL.createObjectURL(blob));
      },
      type,
      quality
    );
  });
}

/**
 * Render an ImageBitmap to a temporary canvas and return a blob object URL.
 * The caller is responsible for calling URL.revokeObjectURL() when done.
 * @param {ImageBitmap} bitmap - The bitmap to convert
 * @param {string} [type='image/png'] - MIME type for the output image
 * @param {number} [quality] - Quality for lossy formats (0–1)
 * @returns {Promise<string>} - A blob: object URL
 */
export async function bitmapToObjectUrl(bitmap, type = 'image/png', quality) {
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0);
  return canvasToObjectUrl(canvas, type, quality);
}
