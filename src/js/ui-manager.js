/**
 * UI Manager
 * Handles all user interface interactions and updates
 */

import { CONFIG } from './config.js';
import { formatFileSize } from './utils.js';

/**
 * UI Manager class
 */
export class UIManager {
  constructor(elements, logger) {
    this.elements = elements;
    this.logger = logger;
    this.currentState = 'idle';  // idle, processing, result
  }

  /**
   * Update progress bar
   * @param {number} percent - Progress percentage (0-100)
   * @param {string} message - Progress message
   */
  updateProgress(percent, message) {
    const { progressContainer, progressBar, progressText } = this.elements;
    
    progressContainer.style.display = 'block';
    progressBar.style.width = `${percent}%`;
    progressText.innerText = `${percent}% - ${message}`;
    
    if (this.logger) {
      this.logger.info(message);
    }
  }

  /**
   * Show error message
   * @param {string} message - Error message
   */
  showError(message) {
    if (this.logger) {
      this.logger.error(message);
    }
    
    // Show error in UI
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-message';
    errorDiv.innerHTML = `
      <div class="error-content">
        <span class="error-icon">⚠️</span>
        <span class="error-text">${message}</span>
        <button class="error-close">×</button>
      </div>
    `;
    
    document.body.appendChild(errorDiv);
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
      errorDiv.classList.add('fade-out');
      setTimeout(() => errorDiv.remove(), 300);
    }, 5000);
    
    // Close button
    errorDiv.querySelector('.error-close').addEventListener('click', () => {
      errorDiv.classList.add('fade-out');
      setTimeout(() => errorDiv.remove(), 300);
    });
  }

  /**
   * Show result
   * @param {string} dataUrl - Processed image data URL
   * @param {string} originalDataUrl - Original image data URL (optional)
   */
  showResult(dataUrl, originalDataUrl = null) {
    const { progressContainer, resultArea, previewImg, downloadLink, comparisonContainer } = this.elements;
    
    setTimeout(() => {
      progressContainer.style.display = 'none';
      resultArea.style.display = 'block';
      previewImg.src = dataUrl;
      downloadLink.href = dataUrl;
      downloadLink.download = `gemini-clean-${Date.now()}.png`;
      
      // Setup comparison slider if original is provided
      if (originalDataUrl && comparisonContainer) {
        this.setupComparisonSlider(originalDataUrl, dataUrl);
      }
      
      this.currentState = 'result';
      
      if (this.logger) {
        this.logger.info('Processing complete! Image ready for download.');
      }
    }, CONFIG.UI.ANIMATION_DELAY);
  }

  /**
   * Setup before/after comparison slider
   * @param {string} beforeUrl - Original image URL
   * @param {string} afterUrl - Processed image URL
   */
  setupComparisonSlider(beforeUrl, afterUrl) {
    const { comparisonContainer } = this.elements;
    if (!comparisonContainer) return;
    
    comparisonContainer.style.display = 'block';
    comparisonContainer.innerHTML = `
      <div class="comparison-wrapper">
        <div class="comparison-images">
          <img src="${afterUrl}" class="comparison-after" alt="After">
          <div class="comparison-before-wrapper" style="width: 50%;">
            <img src="${beforeUrl}" class="comparison-before" alt="Before">
          </div>
        </div>
        <input type="range" min="0" max="100" value="50" class="comparison-slider">
        <div class="comparison-labels">
          <span class="label-before">Original</span>
          <span class="label-after">Cleaned</span>
        </div>
      </div>
    `;
    
    const slider = comparisonContainer.querySelector('.comparison-slider');
    const beforeWrapper = comparisonContainer.querySelector('.comparison-before-wrapper');
    
    slider.addEventListener('input', (e) => {
      const value = e.target.value;
      beforeWrapper.style.width = `${value}%`;
    });
  }

  /**
   * Reset UI to initial state
   */
  reset() {
    const { dropZone, resultArea, progressContainer, fileInput, comparisonContainer } = this.elements;
    
    resultArea.style.display = 'none';
    dropZone.style.display = 'flex';
    progressContainer.style.display = 'none';
    
    if (comparisonContainer) {
      comparisonContainer.style.display = 'none';
      comparisonContainer.innerHTML = '';
    }
    
    fileInput.value = '';
    
    if (this.logger) {
      this.logger.clear();
    }
    
    this.currentState = 'idle';
  }

  /**
   * Set processing state
   */
  setProcessing() {
    const { dropZone, resultArea } = this.elements;
    
    dropZone.style.display = 'none';
    resultArea.style.display = 'none';
    
    this.currentState = 'processing';
  }

  /**
   * Setup drag and drop handlers
   * @param {Function} onFilesSelected - Callback when file(s) are selected
   */
  setupDragAndDrop(onFilesSelected) {
    const { dropZone, fileInput } = this.elements;
    
    // Click to browse
    dropZone.addEventListener('click', () => fileInput.click());
    
    // Drag over
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    });
    
    // Drag leave
    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('dragover');
    });
    
    // Drop - pass all files
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      
      if (e.dataTransfer.files.length > 0) {
        onFilesSelected(e.dataTransfer.files);
      }
    });
    
    // File input change - pass all files
    fileInput.addEventListener('change', () => {
      if (fileInput.files.length > 0) {
        onFilesSelected(fileInput.files);
      }
    });
  }

  /**
   * Setup reset button
   * @param {Function} onReset - Callback when reset is clicked
   */
  setupResetButton(onReset) {
    const { resetBtn } = this.elements;
    
    resetBtn.addEventListener('click', () => {
      this.reset();
      if (onReset) onReset();
    });
  }

  /**
   * Get current state
   * @returns {string} - Current UI state
   */
  getState() {
    return this.currentState;
  }

  // ===== Batch UI Methods =====

  /**
   * Show batch status section
   * @param {boolean} show - Whether to show the section
   */
  showBatchStatus(show) {
    const batchStatus = document.getElementById('batchStatus');
    if (batchStatus) {
      batchStatus.style.display = show ? 'block' : 'none';
    }
  }

  /**
   * Update batch progress count
   * @param {number} completed - Number of completed items
   * @param {number} total - Total number of items
   */
  updateBatchProgress(completed, total) {
    const batchCount = document.getElementById('batchCount');
    if (batchCount) {
      batchCount.textContent = `Processing ${completed} of ${total} images`;
    }
  }

  /**
   * Add a batch item card to the UI
   * @param {string} id - Unique item ID
   * @param {string} fileName - File name
   * @param {number} fileSize - File size in bytes
   * @param {File} file - The actual file for thumbnail
   */
  addBatchItem(id, fileName, fileSize, file) {
    const batchItems = document.getElementById('batchItems');
    if (!batchItems) return;

    const item = document.createElement('div');
    item.className = 'batch-item queued';
    item.id = `batch-item-${id}`;
    item.innerHTML = `
      <img class="batch-item-thumbnail" alt="${fileName}" />
      <div class="batch-item-info">
        <div class="batch-item-name">${fileName}</div>
        <div class="batch-item-size">${formatFileSize(fileSize)}</div>
      </div>
      <div class="batch-item-status"></div>
    `;

    batchItems.appendChild(item);

    // Load thumbnail
    if (file) {
      this.loadThumbnail(item.querySelector('.batch-item-thumbnail'), file);
    }
  }

  /**
   * Load file thumbnail
   * @param {HTMLImageElement} imgElement - Image element to load into
   * @param {File} file - File to create thumbnail from
   */
  loadThumbnail(imgElement, file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      imgElement.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  /**
   * Update batch item status
   * @param {string} id - Item ID
   * @param {string} status - New status (queued, processing, complete, error, cancelled)
   * @param {Object} data - Additional data (error message, thumbnail, etc.)
   */
  updateBatchItemStatus(id, status, data = {}) {
    const item = document.getElementById(`batch-item-${id}`);
    if (!item) return;

    // Remove old status classes
    item.classList.remove('queued', 'processing', 'complete', 'error', 'cancelled');
    item.classList.add(status);

    // Update thumbnail with processed image if available
    if (data && data.thumbnail) {
      const thumbnail = item.querySelector('.batch-item-thumbnail');
      if (thumbnail) {
        thumbnail.src = data.thumbnail;
      }
    }

    // Show error message if present
    if (data && data.error) {
      let errorDiv = item.querySelector('.batch-item-error');
      if (!errorDiv) {
        errorDiv = document.createElement('div');
        errorDiv.className = 'batch-item-error';
        item.querySelector('.batch-item-info').appendChild(errorDiv);
      }
      errorDiv.textContent = data.error;
    }
  }

  /**
   * Clear batch items
   */
  clearBatchItems() {
    const batchItems = document.getElementById('batchItems');
    if (batchItems) {
      batchItems.innerHTML = '';
    }
  }

  /**
   * Show batch results gallery
   * @param {Array} results - Array of { id, fileName, dataUrl }
   */
  showBatchResults(results) {
    const { resultArea, previewImg, downloadLink, comparisonContainer } = this.elements;
    const downloadAllBtn = document.getElementById('downloadAllBtn');

    // Hide single image preview, show batch gallery
    if (previewImg) previewImg.style.display = 'none';
    if (downloadLink) downloadLink.style.display = 'none';
    if (comparisonContainer) comparisonContainer.style.display = 'none';

    // Show download all button
    if (downloadAllBtn) downloadAllBtn.style.display = 'inline-flex';

    // Create results gallery if not exists
    let gallery = resultArea.querySelector('.batch-results');
    if (!gallery) {
      gallery = document.createElement('div');
      gallery.className = 'batch-results';
      // Insert before action buttons
      const actionButtons = resultArea.querySelector('.action-buttons');
      resultArea.insertBefore(gallery, actionButtons);
    }

    // Populate gallery
    gallery.innerHTML = results.map(result => `
      <div class="batch-result-item" data-id="${result.id}">
        <img class="batch-result-img" src="${result.dataUrl}" alt="${result.fileName}" />
        <div class="batch-result-overlay">
          <div class="batch-result-name">${result.fileName.replace(/\.[^.]+$/, '')}-clean.png</div>
        </div>
        <button class="batch-result-download" data-url="${result.dataUrl}" data-name="${result.fileName}">⬇️</button>
      </div>
    `).join('');

    // Add click handlers for individual downloads
    gallery.querySelectorAll('.batch-result-download').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const url = btn.dataset.url;
        const name = btn.dataset.name.replace(/\.[^.]+$/, '') + '-clean.png';
        this.downloadImage(url, name);
      });
    });

    resultArea.style.display = 'block';
    this.currentState = 'result';
  }

  /**
   * Download a single image
   * @param {string} dataUrl - Image data URL
   * @param {string} fileName - File name
   */
  downloadImage(dataUrl, fileName) {
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  /**
   * Reset batch UI
   */
  resetBatch() {
    this.showBatchStatus(false);
    this.clearBatchItems();
    
    const downloadAllBtn = document.getElementById('downloadAllBtn');
    if (downloadAllBtn) downloadAllBtn.style.display = 'none';

    const gallery = document.querySelector('.batch-results');
    if (gallery) gallery.remove();

    // Restore single image elements
    const { previewImg, downloadLink } = this.elements;
    if (previewImg) previewImg.style.display = 'block';
    if (downloadLink) downloadLink.style.display = 'inline-flex';
  }
}

