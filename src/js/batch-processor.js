/**
 * Batch Processor Module
 * Manages queue-based processing of multiple images
 */

import { CONFIG } from "./config.js";
import {
  validateImageFile,
  loadImageFromFile,
  formatFileSize,
} from "./utils.js";

/**
 * Status enum for batch items
 */
export const BatchItemStatus = {
  QUEUED: "queued",
  PROCESSING: "processing",
  COMPLETE: "complete",
  ERROR: "error",
  CANCELLED: "cancelled",
};

/**
 * BatchProcessor class
 * Handles sequential processing of multiple images
 */
export class BatchProcessor {
  /**
   * @param {Function} processCallback - Async function that processes a single image, returns { dataUrl, originalDataUrl }
   * @param {Function} onItemUpdate - Callback when an item's status changes (id, status, data)
   * @param {Function} onProgressUpdate - Callback for overall progress (completed, total)
   * @param {Function} onComplete - Callback when all items are processed (results)
   */
  constructor(processCallback, onItemUpdate, onProgressUpdate, onComplete) {
    this.queue = []; // Array of { id, file, status, result, error }
    this.processCallback = processCallback;
    this.onItemUpdate = onItemUpdate;
    this.onProgressUpdate = onProgressUpdate;
    this.onComplete = onComplete;
    this.isProcessing = false;
    this.isCancelled = false;
    this.currentIndex = 0;
  }

  /**
   * Generate unique ID for batch item
   * @returns {string}
   */
  generateId() {
    return `batch-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Add files to the processing queue
   * @param {FileList|File[]} files - Files to add
   * @returns {Array} - Array of added item IDs
   */
  addFiles(files) {
    const addedIds = [];

    for (const file of files) {
      // Validate file
      const validation = validateImageFile(file);

      const item = {
        id: this.generateId(),
        file: file,
        fileName: file.name,
        fileSize: file.size,
        status: validation.valid
          ? BatchItemStatus.QUEUED
          : BatchItemStatus.ERROR,
        result: null,
        error: validation.valid ? null : validation.error,
        thumbnail: null,
      };

      this.queue.push(item);
      addedIds.push(item.id);

      // Notify UI about new item
      if (this.onItemUpdate) {
        this.onItemUpdate(item.id, item.status, {
          fileName: item.fileName,
          fileSize: item.fileSize,
          error: item.error,
        });
      }
    }

    return addedIds;
  }

  /**
   * Get current progress
   * @returns {Object} - { completed, total, processing }
   */
  getProgress() {
    const completed = this.queue.filter(
      (item) =>
        item.status === BatchItemStatus.COMPLETE ||
        item.status === BatchItemStatus.ERROR ||
        item.status === BatchItemStatus.CANCELLED
    ).length;

    const processing = this.queue.find(
      (item) => item.status === BatchItemStatus.PROCESSING
    );

    return {
      completed,
      total: this.queue.length,
      processing: processing ? processing.fileName : null,
    };
  }

  /**
   * Get all successful results
   * @returns {Array} - Array of { id, fileName, dataUrl, originalDataUrl }
   */
  getResults() {
    return this.queue
      .filter((item) => item.status === BatchItemStatus.COMPLETE && item.result)
      .map((item) => ({
        id: item.id,
        fileName: item.fileName,
        dataUrl: item.result.dataUrl,
        originalDataUrl: item.result.originalDataUrl,
      }));
  }

  /**
   * Start processing the queue
   */
  async start() {
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;
    this.isCancelled = false;

    // Process each item in queue sequentially
    for (let i = 0; i < this.queue.length; i++) {
      if (this.isCancelled) {
        // Mark remaining items as cancelled
        for (let j = i; j < this.queue.length; j++) {
          if (this.queue[j].status === BatchItemStatus.QUEUED) {
            this.queue[j].status = BatchItemStatus.CANCELLED;
            if (this.onItemUpdate) {
              this.onItemUpdate(
                this.queue[j].id,
                BatchItemStatus.CANCELLED,
                null
              );
            }
          }
        }
        break;
      }

      const item = this.queue[i];

      // Skip already processed or errored items
      if (item.status !== BatchItemStatus.QUEUED) {
        continue;
      }

      // Update status to processing
      item.status = BatchItemStatus.PROCESSING;
      this.currentIndex = i;

      if (this.onItemUpdate) {
        this.onItemUpdate(item.id, BatchItemStatus.PROCESSING, null);
      }

      if (this.onProgressUpdate) {
        const progress = this.getProgress();
        this.onProgressUpdate(progress.completed, progress.total);
      }

      try {
        // Process the image
        const result = await this.processCallback(item.file);

        item.status = BatchItemStatus.COMPLETE;
        item.result = result;

        if (this.onItemUpdate) {
          this.onItemUpdate(item.id, BatchItemStatus.COMPLETE, {
            dataUrl: result.dataUrl,
            thumbnail: result.dataUrl, // Use processed image as thumbnail
          });
        }
      } catch (error) {
        item.status = BatchItemStatus.ERROR;
        item.error = error.message || "Processing failed";

        if (this.onItemUpdate) {
          this.onItemUpdate(item.id, BatchItemStatus.ERROR, {
            error: item.error,
          });
        }
      }

      // Update overall progress
      if (this.onProgressUpdate) {
        const progress = this.getProgress();
        this.onProgressUpdate(progress.completed, progress.total);
      }
    }

    this.isProcessing = false;

    // Notify completion
    if (this.onComplete) {
      this.onComplete(this.getResults());
    }
  }

  /**
   * Cancel processing
   */
  cancel() {
    this.isCancelled = true;
  }

  /**
   * Reset the processor
   */
  reset() {
    this.queue = [];
    this.isProcessing = false;
    this.isCancelled = false;
    this.currentIndex = 0;
  }

  /**
   * Get queue length
   * @returns {number}
   */
  get length() {
    return this.queue.length;
  }

  /**
   * Check if batch has any successful results
   * @returns {boolean}
   */
  hasResults() {
    return this.queue.some((item) => item.status === BatchItemStatus.COMPLETE);
  }
}
