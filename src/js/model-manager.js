/**
 * Model Manager
 * Handles ONNX model loading, caching, and inference
 */

import { CONFIG } from './config.js';

/**
 * Model Manager class
 * Singleton pattern to ensure only one model instance
 */
class ModelManager {
  /** Minimum valid model size — anything smaller is definitely not a real ONNX model (e.g. an HTML fallback page) */
  static MIN_MODEL_BYTES = 1024 * 1024; // 1 MB

  constructor() {
    this.session = null;
    this.modelBuffer = null;
    this.isInitialized = false;
    this.initializationPromise = null;
  }

  /**
   * Validate that a buffer looks like a real ONNX model.
   * Checks minimum size and that the first byte is 0x08 (protobuf field 1, varint),
   * which encodes the ir_version field present in every ONNX model.
   * @param {Uint8Array|ArrayBuffer} buf
   * @returns {boolean}
   */
  _isValidOnnxBuffer(buf) {
    if (!buf) return false;
    const len = buf.byteLength ?? buf.length ?? 0;
    if (len < ModelManager.MIN_MODEL_BYTES) return false;
    // First byte of a valid ONNX protobuf is 0x08 (field 1, wire type 0 = varint)
    const view = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    return view[0] === 0x08;
  }

  /**
   * Initialize ONNX Runtime environment
   */
  initializeOnnxRuntime() {
    if (typeof ort === 'undefined') {
      throw new Error('ONNX Runtime not loaded');
    }
    
    ort.env.wasm.wasmPaths = CONFIG.ONNX.WASM_PATHS;
    ort.env.wasm.numThreads = CONFIG.MODEL.NUM_THREADS;
    ort.env.wasm.proxy = CONFIG.ONNX.PROXY;
  }

  /**
   * Open (or create) the IndexedDB database
   * @returns {Promise<IDBDatabase>}
   */
  _openDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(CONFIG.CACHE.DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(CONFIG.CACHE.STORE_NAME)) {
          db.createObjectStore(CONFIG.CACHE.STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Try to load the model from IndexedDB cache
   * @param {string} key - Cache key (model path)
   * @returns {Promise<Uint8Array|null>}
   */
  async _getFromDB(key) {
    try {
      const db = await this._openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(CONFIG.CACHE.STORE_NAME, 'readonly');
        const store = tx.objectStore(CONFIG.CACHE.STORE_NAME);
        const request = store.get(key);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
    } catch {
      console.warn('IndexedDB read failed, will fetch from network');
      return null;
    }
  }

  /**
   * Save model buffer to IndexedDB cache
   * @param {string} key - Cache key (model path)
   * @param {Uint8Array} data - Model buffer
   */
  async _saveToDB(key, data) {
    try {
      const db = await this._openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(CONFIG.CACHE.STORE_NAME, 'readwrite');
        const store = tx.objectStore(CONFIG.CACHE.STORE_NAME);
        const request = store.put(data, key);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } catch (err) {
      console.warn('IndexedDB write failed:', err);
    }
  }

  /**
   * Delete model from IndexedDB cache
   * @param {string} key - Cache key (model path)
   */
  async _deleteFromDB(key) {
    try {
      const db = await this._openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(CONFIG.CACHE.STORE_NAME, 'readwrite');
        const store = tx.objectStore(CONFIG.CACHE.STORE_NAME);
        const request = store.delete(key);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } catch (err) {
      console.warn('IndexedDB delete failed:', err);
    }
  }

  /**
   * Fetch model with progress tracking
   * @param {string} url - Model URL
   * @param {Function} onProgress - Progress callback (percent, bytesLoaded)
   * @returns {Promise<Uint8Array>} - Model buffer
   */
  async fetchModelWithProgress(url, onProgress) {
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch model: ${response.statusText}`);
    }
    
    const contentLength = parseInt(response.headers.get('Content-Length') || '0', 10);
    const reader = response.body.getReader();
    
    let receivedLength = 0;
    const chunks = [];
    
    while (true) {
      const { done, value } = await reader.read();
      
      if (done) break;
      
      chunks.push(value);
      receivedLength += value.length;
      
      // Calculate progress
      if (contentLength > 0 && onProgress) {
        const percent = Math.round((receivedLength / contentLength) * 100);
        onProgress(percent, receivedLength);
      }
    }
    
    // Combine chunks into single Uint8Array
    const allChunks = new Uint8Array(receivedLength);
    let position = 0;
    for (const chunk of chunks) {
      allChunks.set(chunk, position);
      position += chunk.length;
    }
    
    return allChunks;
  }

  /**
   * Initialize the model
   * @param {Function} onProgress - Progress callback
   * @returns {Promise<void>}
   */
  async initialize(onProgress) {
    // If already initialized, return immediately
    if (this.isInitialized) {
      return;
    }
    
    // If initialization is in progress, wait for it
    if (this.initializationPromise) {
      return this.initializationPromise;
    }
    
    // Start initialization
    this.initializationPromise = (async () => {
      try {
        // Initialize ONNX Runtime
        this.initializeOnnxRuntime();
        
        // Load model buffer: memory → IndexedDB → network
        if (!this.modelBuffer) {
          // Try IndexedDB cache first
          const cached = await this._getFromDB(CONFIG.MODEL.PATH);
          if (cached && this._isValidOnnxBuffer(cached)) {
            console.log('Loaded model from IndexedDB cache');
            this.modelBuffer = cached;
          } else {
            if (cached) {
              console.warn('Corrupt model cache detected — purging and re-fetching');
              await this._deleteFromDB(CONFIG.MODEL.PATH);
            }
            // Cache miss or invalid — fetch from network
            this.modelBuffer = await this.fetchModelWithProgress(
              CONFIG.MODEL.PATH,
              (percent, bytes) => {
                if (onProgress) {
                  const startPercent = CONFIG.UI.PROGRESS_STEPS.MODEL_DOWNLOAD_START;
                  const endPercent = CONFIG.UI.PROGRESS_STEPS.MODEL_DOWNLOAD_END;
                  const progressPercent = startPercent + (percent / 100) * (endPercent - startPercent);
                  onProgress(Math.round(progressPercent), bytes);
                }
              }
            );
            // Validate the freshly-downloaded buffer too
            if (!this._isValidOnnxBuffer(this.modelBuffer)) {
              this.modelBuffer = null;
              throw new Error('Downloaded model is invalid (too small or wrong format)');
            }
            // Persist to IndexedDB in background (fire-and-forget)
            this._saveToDB(CONFIG.MODEL.PATH, this.modelBuffer)
              .then(() => console.log('Model cached to IndexedDB'))
              .catch(err => console.warn('Failed to cache model to IndexedDB:', err));
          }
        }
        
        // Create inference session
        if (onProgress) {
          onProgress(CONFIG.UI.PROGRESS_STEPS.MODEL_INIT, null);
        }
        
        try {
          this.session = await ort.InferenceSession.create(this.modelBuffer, {
            executionProviders: CONFIG.MODEL.EXECUTION_PROVIDERS,
            graphOptimizationLevel: CONFIG.MODEL.OPTIMIZATION_LEVEL
          });
        } catch (sessionError) {
          // Auto-recovery: wipe the potentially corrupt cache so a retry can succeed
          console.error('InferenceSession.create failed — clearing cache for recovery:', sessionError.message);
          this.modelBuffer = null;
          await this._deleteFromDB(CONFIG.MODEL.PATH).catch(() => {});
          throw sessionError;
        }
        
        this.isInitialized = true;
        
        if (onProgress) {
          onProgress(CONFIG.UI.PROGRESS_STEPS.MODEL_READY, null);
        }
      } catch (error) {
        this.initializationPromise = null;
        throw new Error(`${CONFIG.ERRORS.MODEL_LOAD_FAILED}: ${error.message}`);
      }
    })();
    
    return this.initializationPromise;
  }

  /**
   * Run inference on input tensors
   * @param {Object} feeds - Input tensors { image: Tensor, mask: Tensor }
   * @returns {Promise<Tensor>} - Output tensor
   */
  async runInference(feeds) {
    if (!this.isInitialized || !this.session) {
      throw new Error('Model not initialized. Call initialize() first.');
    }
    
    try {
      const results = await this.session.run(feeds);
      
      // Get first output (LaMa model has single output)
      const outputName = Object.keys(results)[0];
      return results[outputName];
    } catch (error) {
      throw new Error(`Inference failed: ${error.message}`);
    }
  }

  /**
   * Release model resources
   */
  async dispose() {
    if (this.session) {
      await this.session.release();
      this.session = null;
    }
    this.isInitialized = false;
    this.initializationPromise = null;
    // Keep modelBuffer cached for faster reinitialization
  }

  /**
   * Clear all cached data including model buffer and IndexedDB
   */
  async clearCache() {
    await this.dispose();
    this.modelBuffer = null;
    await this._deleteFromDB(CONFIG.MODEL.PATH);
    console.log('Model cache cleared (memory + IndexedDB)');
  }

  /**
   * Get model info
   * @returns {Object} - Model information
   */
  getInfo() {
    return {
      isInitialized: this.isInitialized,
      hasModelBuffer: this.modelBuffer !== null,
      modelPath: CONFIG.MODEL.PATH,
      inputSize: CONFIG.MODEL.INPUT_SIZE
    };
  }
}

// Export singleton instance
export const modelManager = new ModelManager();
