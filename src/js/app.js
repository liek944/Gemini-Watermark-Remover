/**
 * Main Application
 * Orchestrates the entire watermark removal process
 * Supports both single image and batch processing
 */

import { CONFIG } from './config.js';
import { validateImageFile, loadImageFromFile, createLogger, formatFileSize } from './utils.js';
import { modelManager } from './model-manager.js';
import { preprocessImage, postprocessImage, composeFinalImage, resizeImageForModel } from './image-processor.js';
import { UIManager } from './ui-manager.js';
import { BatchProcessor, BatchItemStatus } from './batch-processor.js';

/**
 * Application class
 */
class Application {
  constructor() {
    this.logger = null;
    this.uiManager = null;
    this.currentImageBitmap = null;
    this.batchProcessor = null;
    this.batchResults = [];
    this.featherSize = CONFIG.WATERMARK.FEATHER_SIZE;  // Edge blend setting
  }

  /**
   * Initialize the application
   */
  async init() {
    // Get DOM elements
    const elements = {
      dropZone: document.getElementById('dropZone'),
      fileInput: document.getElementById('fileInput'),
      progressContainer: document.getElementById('progressContainer'),
      progressBar: document.getElementById('progressBar'),
      progressText: document.getElementById('progressText'),
      resultArea: document.getElementById('resultArea'),
      previewImg: document.getElementById('previewImg'),
      downloadLink: document.getElementById('downloadLink'),
      resetBtn: document.getElementById('resetBtn'),
      logArea: document.getElementById('logArea'),
      comparisonContainer: document.getElementById('comparisonContainer')
    };

    // Initialize logger
    this.logger = createLogger(elements.logArea);
    this.logger.info('Application initialized');

    // Initialize UI manager
    this.uiManager = new UIManager(elements, this.logger);

    // Setup event handlers
    this.uiManager.setupDragAndDrop((files) => this.handleFileSelection(files));
    this.uiManager.setupResetButton(() => this.handleReset());
    
    // Setup batch-specific handlers
    this.setupBatchHandlers();
    
    // Setup advanced settings
    this.setupAdvancedSettings();

    this.logger.info('Ready to process images (batch upload supported)');
  }

  /**
   * Setup advanced settings handlers
   */
  setupAdvancedSettings() {
    const featherSlider = document.getElementById('featherSlider');
    const featherValue = document.getElementById('featherValue');
    
    if (featherSlider && featherValue) {
      // Update display when slider changes
      featherSlider.addEventListener('input', (e) => {
        this.featherSize = parseInt(e.target.value, 10);
        featherValue.textContent = `${this.featherSize}px`;
      });
      
      // Initialize from config
      featherSlider.value = this.featherSize;
      featherValue.textContent = `${this.featherSize}px`;
    }
  }

  /**
   * Setup batch-specific event handlers
   */
  setupBatchHandlers() {
    // Cancel batch button
    const cancelBtn = document.getElementById('cancelBatch');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => this.handleCancelBatch());
    }

    // Download all as ZIP button
    const downloadAllBtn = document.getElementById('downloadAllBtn');
    if (downloadAllBtn) {
      downloadAllBtn.addEventListener('click', () => this.handleDownloadAllAsZip());
    }
  }

  /**
   * Handle file selection (single or multiple)
   * @param {File|FileList} filesOrFile - Selected file(s)
   */
  async handleFileSelection(filesOrFile) {
    // Handle both single File and FileList
    const files = filesOrFile instanceof FileList ? Array.from(filesOrFile) : [filesOrFile];
    
    if (files.length === 0) {
      return;
    }

    // Single file - use original flow
    if (files.length === 1) {
      await this.handleSingleFile(files[0]);
    } else {
      // Multiple files - use batch processing
      await this.handleBatchFiles(files);
    }
  }

  /**
   * Handle single file (original flow)
   * @param {File} file - Selected file
   */
  async handleSingleFile(file) {
    // Validate file
    const validation = validateImageFile(file);
    if (!validation.valid) {
      this.uiManager.showError(validation.error);
      return;
    }

    this.logger.info(`File selected: ${file.name} (${formatFileSize(file.size)})`);

    // Start processing
    this.uiManager.setProcessing();

    try {
      await this.processImage(file);
    } catch (error) {
      this.logger.error(`Processing failed: ${error.message}`);
      this.uiManager.showError(`${CONFIG.ERRORS.PROCESSING_FAILED}: ${error.message}`);
      this.uiManager.reset();
    }
  }

  /**
   * Handle batch file processing
   * @param {File[]} files - Array of files
   */
  async handleBatchFiles(files) {
    this.logger.info(`Batch upload: ${files.length} files selected`);

    // Hide drop zone, show batch status
    this.uiManager.setProcessing();
    this.uiManager.showBatchStatus(true);
    this.uiManager.clearBatchItems();

    // Create batch processor
    this.batchProcessor = new BatchProcessor(
      // Process callback - reuse existing processImage logic
      async (file) => await this.processSingleImageForBatch(file),
      
      // Item update callback
      (id, status, data) => {
        this.uiManager.updateBatchItemStatus(id, status, data);
      },
      
      // Progress update callback
      (completed, total) => {
        this.uiManager.updateBatchProgress(completed, total);
      },
      
      // Complete callback
      (results) => {
        this.handleBatchComplete(results);
      }
    );

    // Add files to queue
    for (const file of files) {
      const ids = this.batchProcessor.addFiles([file]);
      if (ids.length > 0) {
        const validation = validateImageFile(file);
        if (validation.valid) {
          this.uiManager.addBatchItem(ids[0], file.name, file.size, file);
        } else {
          this.uiManager.addBatchItem(ids[0], file.name, file.size, file);
        }
      }
    }

    // Update initial count
    this.uiManager.updateBatchProgress(0, files.length);

    // Pre-initialize model before batch processing
    this.logger.info('Pre-loading AI model for batch processing...');
    try {
      await modelManager.initialize((percent, bytes) => {
        if (bytes !== null) {
          this.logger.info(`Downloading model (${formatFileSize(bytes)})...`);
        }
      });
      this.logger.info('AI model ready');
    } catch (error) {
      this.logger.error(`Model initialization failed: ${error.message}`);
      this.uiManager.showError(CONFIG.ERRORS.MODEL_LOAD_FAILED);
      this.uiManager.reset();
      return;
    }

    // Start batch processing
    await this.batchProcessor.start();
  }

  /**
   * Process a single image for batch mode (returns result instead of updating UI)
   * @param {File} file - Image file
   * @returns {Object} - { dataUrl, originalDataUrl }
   */
  async processSingleImageForBatch(file) {
    // Load image
    const imageBitmap = await loadImageFromFile(file);
    
    this.logger.info(`Processing: ${file.name} (${imageBitmap.width}x${imageBitmap.height}px)`);

    // Prepare input
    const resizedImageData = resizeImageForModel(imageBitmap);
    const { imageTensor, maskTensor } = preprocessImage(resizedImageData);

    // Run inference
    const outputTensor = await modelManager.runInference({
      image: imageTensor,
      mask: maskTensor
    });

    // Postprocess
    const processedImageData = postprocessImage(
      outputTensor,
      CONFIG.MODEL.INPUT_SIZE,
      CONFIG.MODEL.INPUT_SIZE
    );

    // Compose final image with feathered edges
    const finalDataUrl = composeFinalImage(imageBitmap, processedImageData, this.featherSize);

    // Create original data URL
    const originalCanvas = document.createElement('canvas');
    originalCanvas.width = imageBitmap.width;
    originalCanvas.height = imageBitmap.height;
    const ctx = originalCanvas.getContext('2d');
    ctx.drawImage(imageBitmap, 0, 0);
    const originalDataUrl = originalCanvas.toDataURL('image/png');

    this.logger.info(`Completed: ${file.name}`);

    return { dataUrl: finalDataUrl, originalDataUrl };
  }

  /**
   * Handle batch processing complete
   * @param {Array} results - Array of successful results
   */
  handleBatchComplete(results) {
    this.batchResults = results;
    
    const successCount = results.length;
    const totalCount = this.batchProcessor ? this.batchProcessor.length : 0;
    const failedCount = totalCount - successCount;

    this.logger.info(`Batch complete: ${successCount} succeeded, ${failedCount} failed`);

    if (results.length > 0) {
      // Show results gallery
      setTimeout(() => {
        this.uiManager.showBatchResults(results);
        this.logger.info('All images ready for download');
      }, CONFIG.UI.ANIMATION_DELAY);
    } else {
      this.uiManager.showError('No images were processed successfully');
      this.uiManager.reset();
    }
  }

  /**
   * Handle cancel batch
   */
  handleCancelBatch() {
    if (this.batchProcessor) {
      this.batchProcessor.cancel();
      this.logger.info('Batch processing cancelled');
    }
  }

  /**
   * Handle download all as ZIP
   */
  async handleDownloadAllAsZip() {
    if (!this.batchResults || this.batchResults.length === 0) {
      this.uiManager.showError('No images to download');
      return;
    }

    // Check if JSZip is available
    if (typeof JSZip === 'undefined') {
      this.uiManager.showError('ZIP library not loaded');
      return;
    }

    this.logger.info('Creating ZIP archive...');

    try {
      const zip = new JSZip();

      // Add each result to the ZIP
      for (let i = 0; i < this.batchResults.length; i++) {
        const result = this.batchResults[i];
        const fileName = result.fileName.replace(/\.[^.]+$/, '') + '-clean.png';
        
        // Convert data URL to base64
        const base64Data = result.dataUrl.split(',')[1];
        zip.file(fileName, base64Data, { base64: true });
      }

      // Generate and download ZIP
      const blob = await zip.generateAsync({ 
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 }
      });

      // Create download link
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `gemini-clean-batch-${Date.now()}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      this.logger.info(`ZIP downloaded: ${this.batchResults.length} images`);
    } catch (error) {
      this.logger.error(`ZIP creation failed: ${error.message}`);
      this.uiManager.showError('Failed to create ZIP file');
    }
  }

  /**
   * Process image through the entire pipeline (original single-image flow)
   * @param {File} file - Image file to process
   */
  async processImage(file) {
    // Step 1: Load image
    this.uiManager.updateProgress(
      CONFIG.UI.PROGRESS_STEPS.FILE_READ,
      'Loading image...'
    );
    
    const imageBitmap = await loadImageFromFile(file);
    this.currentImageBitmap = imageBitmap;
    
    this.logger.info(`Image loaded: ${imageBitmap.width}x${imageBitmap.height}px`);

    // Step 2: Initialize model
    this.uiManager.updateProgress(
      CONFIG.UI.PROGRESS_STEPS.MODEL_CHECK,
      'Checking AI model...'
    );

    await modelManager.initialize((percent, bytes) => {
      if (bytes !== null) {
        this.uiManager.updateProgress(
          percent,
          `Downloading model (${formatFileSize(bytes)})...`
        );
      } else {
        this.uiManager.updateProgress(
          percent,
          'Initializing neural engine...'
        );
      }
    });

    // Step 3: Prepare input
    this.uiManager.updateProgress(
      CONFIG.UI.PROGRESS_STEPS.PREPROCESSING,
      'Preparing image for AI processing...'
    );

    const resizedImageData = resizeImageForModel(imageBitmap);
    const { imageTensor, maskTensor } = preprocessImage(resizedImageData);
    
    this.logger.info(`Preprocessed to ${CONFIG.MODEL.INPUT_SIZE}x${CONFIG.MODEL.INPUT_SIZE}px`);

    // Step 4: Run inference
    this.uiManager.updateProgress(
      CONFIG.UI.PROGRESS_STEPS.INFERENCE,
      'Removing watermark with AI...'
    );

    // Small delay to allow UI update
    await new Promise(resolve => setTimeout(resolve, 100));

    const outputTensor = await modelManager.runInference({
      image: imageTensor,
      mask: maskTensor
    });

    this.logger.info('AI processing complete');

    // Step 5: Postprocess
    this.uiManager.updateProgress(
      CONFIG.UI.PROGRESS_STEPS.POSTPROCESSING,
      'Composing final high-resolution image...'
    );

    const processedImageData = postprocessImage(
      outputTensor,
      CONFIG.MODEL.INPUT_SIZE,
      CONFIG.MODEL.INPUT_SIZE
    );

    // Step 6: Compose final image with feathered edges
    const finalDataUrl = composeFinalImage(imageBitmap, processedImageData, this.featherSize);
    
    this.logger.info('Final image composed at original resolution');

    // Step 7: Show result
    this.uiManager.updateProgress(
      CONFIG.UI.PROGRESS_STEPS.COMPLETE,
      'Complete!'
    );

    // Create original data URL for comparison
    const originalCanvas = document.createElement('canvas');
    originalCanvas.width = imageBitmap.width;
    originalCanvas.height = imageBitmap.height;
    const ctx = originalCanvas.getContext('2d');
    ctx.drawImage(imageBitmap, 0, 0);
    const originalDataUrl = originalCanvas.toDataURL('image/png');

    this.uiManager.showResult(finalDataUrl, originalDataUrl);
  }

  /**
   * Handle reset action
   */
  handleReset() {
    this.currentImageBitmap = null;
    this.batchProcessor = null;
    this.batchResults = [];
    this.uiManager.resetBatch();
    this.logger.info('Reset - Ready for new images');
  }
}

// Initialize app when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    const app = new Application();
    app.init();
  });
} else {
  const app = new Application();
  app.init();
}
