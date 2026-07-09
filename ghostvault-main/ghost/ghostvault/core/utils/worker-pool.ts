/**
 * Worker Pool for Parallel Operations
 * Manages a pool of Web Workers for efficient parallel processing
 */

// crypto is available globally in browser secure contexts
declare const crypto: Crypto;

interface WorkerTask<T> {
  id: string;
  data: any;
  resolve: (result: T) => void;
  reject: (error: Error) => void;
}

interface WorkerWrapper {
  worker: Worker;
  busy: boolean;
  taskId: string | null;
}

export class WorkerPool<T> {
  private workers: WorkerWrapper[] = [];
  private taskQueue: WorkerTask<T>[] = [];
  private maxWorkers: number;
  private workerScript: string | Blob;
  private activeTasks: Map<string, WorkerTask<T>> = new Map();

  constructor(workerScript: string | Blob, maxWorkers: number = navigator.hardwareConcurrency || 4) {
    this.workerScript = workerScript;
    this.maxWorkers = Math.max(1, maxWorkers);
  }

  /**
   * Initialize the worker pool
   */
  async init(): Promise<void> {
    // Create workers
    for (let i = 0; i < this.maxWorkers; i++) {
      const worker = this.createWorker();
      this.workers.push({
        worker,
        busy: false,
        taskId: null,
      });
    }
  }

  /**
   * Create a new worker instance
   */
  private createWorker(): Worker {
    let worker: Worker;
    
    if (typeof this.workerScript === 'string') {
      worker = new Worker(this.workerScript);
    } else {
      worker = new Worker(URL.createObjectURL(this.workerScript));
    }

    worker.onmessage = (e) => this.handleWorkerMessage(worker, e);
    worker.onerror = (e) => this.handleWorkerError(worker, e);

    return worker;
  }

  /**
   * Handle messages from workers
   */
  private handleWorkerMessage(worker: Worker, event: MessageEvent): void {
    const { type, data, chunkId, error } = event.data;
    const workerWrapper = this.workers.find(w => w.worker === worker);
    
    if (!workerWrapper) return;

    if (type === 'error') {
      const task = this.activeTasks.get(chunkId || data?.chunkId || '');
      if (task) {
        task.reject(new Error(error || 'Unknown worker error'));
        this.activeTasks.delete(chunkId || data?.chunkId || '');
      }
    } else if (type === 'encryptResult' || type === 'decryptResult' || 
               type === 'compressResult' || type === 'decompressResult' ||
               type === 'checksumResult') {
      const task = this.activeTasks.get(chunkId || '');
      if (task) {
        task.resolve(data);
        this.activeTasks.delete(chunkId || '');
      }
    } else if (type === 'encryptBatchResult' || type === 'decryptBatchResult' ||
               type === 'compressBatchResult' || type === 'decompressBatchResult' ||
               type === 'checksumsResult') {
      const task = this.activeTasks.get('batch_' + (chunkId || ''));
      if (task) {
        task.resolve(data);
        this.activeTasks.delete('batch_' + (chunkId || ''));
      }
    }

    // Mark worker as available
    workerWrapper.busy = false;
    workerWrapper.taskId = null;
    
    // Process next task
    this.processQueue();
  }

  /**
   * Handle worker errors
   */
  private handleWorkerError(worker: Worker, event: ErrorEvent): void {
    console.error('Worker error:', event.error);
    const workerWrapper = this.workers.find(w => w.worker === worker);
    
    if (workerWrapper && workerWrapper.taskId) {
      const task = this.activeTasks.get(workerWrapper.taskId);
      if (task) {
        task.reject(new Error(event.message || 'Worker error'));
        this.activeTasks.delete(workerWrapper.taskId);
      }
      workerWrapper.busy = false;
      workerWrapper.taskId = null;
    }

    // Process next task
    this.processQueue();
  }

  /**
   * Execute a task on an available worker
   */
  async execute(taskType: string, data: any): Promise<T> {
    const taskId = data.chunkId || 'task_' + Date.now() + '_' + crypto.getRandomValues(new Uint32Array(1))[0];
    
    return new Promise((resolve, reject) => {
      const task: WorkerTask<T> = {
        id: taskId,
        data,
        resolve,
        reject,
      };

      this.taskQueue.push(task);
      this.activeTasks.set(taskId, task);
      this.processQueue();
    });
  }

  /**
   * Process the task queue
   */
  private processQueue(): void {
    while (this.taskQueue.length > 0) {
      const availableWorker = this.workers.find(w => !w.busy);
      
      if (!availableWorker) break;

      const task = this.taskQueue.shift();
      if (!task) break;

      availableWorker.busy = true;
      availableWorker.taskId = task.id;
      
      availableWorker.worker.postMessage({
        type: task.data.type || task.data.operation,
        data: task.data,
      });
    }
  }

  /**
   * Execute multiple tasks in parallel
   */
  async executeAll(tasks: Array<{ type: string; data: any }>): Promise<T[]> {
    const promises = tasks.map(task => this.execute(task.type, task.data));
    return Promise.all(promises);
  }

  /**
   * Execute tasks in batches
   */
  async executeBatch(
    tasks: Array<{ type: string; data: any }>,
    batchSize: number = this.maxWorkers
  ): Promise<T[]> {
    const results: T[] = [];
    
    for (let i = 0; i < tasks.length; i += batchSize) {
      const batch = tasks.slice(i, i + batchSize);
      const batchResults = await this.executeAll(batch);
      results.push(...batchResults);
      
      // Yield to event loop
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    
    return results;
  }

  /**
   * Get pool statistics
   */
  getStats(): {
    totalWorkers: number;
    busyWorkers: number;
    queuedTasks: number;
    activeTasks: number;
  } {
    return {
      totalWorkers: this.workers.length,
      busyWorkers: this.workers.filter(w => w.busy).length,
      queuedTasks: this.taskQueue.length,
      activeTasks: this.activeTasks.size,
    };
  }

  /**
   * Terminate all workers
   */
  terminate(): void {
    for (const workerWrapper of this.workers) {
      workerWrapper.worker.terminate();
    }
    this.workers = [];
    this.taskQueue = [];
    this.activeTasks.clear();
  }

  /**
   * Restart a specific worker
   */
  async restartWorker(index: number): Promise<void> {
    if (index < 0 || index >= this.workers.length) {
      throw new Error('Invalid worker index');
    }

    const workerWrapper = this.workers[index];
    workerWrapper.worker.terminate();
    
    const newWorker = this.createWorker();
    this.workers[index] = {
      worker: newWorker,
      busy: false,
      taskId: null,
    };
  }

  /**
   * Add more workers to the pool
   */
  async addWorkers(count: number): Promise<void> {
    const newCount = Math.min(count, this.maxWorkers - this.workers.length);
    
    for (let i = 0; i < newCount; i++) {
      const worker = this.createWorker();
      this.workers.push({
        worker,
        busy: false,
        taskId: null,
      });
    }
  }

  /**
   * Remove workers from the pool
   */
  async removeWorkers(count: number): Promise<void> {
    const removeCount = Math.min(count, this.workers.length - 1); // Keep at least 1 worker
    
    for (let i = 0; i < removeCount; i++) {
      const workerWrapper = this.workers.pop();
      if (workerWrapper) {
        if (!workerWrapper.busy) {
          workerWrapper.worker.terminate();
        } else {
          // Wait for busy worker to finish
          await new Promise(resolve => {
            const checkInterval = setInterval(() => {
              if (!workerWrapper.busy) {
                clearInterval(checkInterval);
                workerWrapper.worker.terminate();
                resolve(undefined);
              }
            }, 100);
          });
        }
      }
    }
  }
}

/**
 * Task scheduler for prioritized task execution
 */
export class TaskScheduler<T> {
  private highPriorityQueue: WorkerTask<T>[] = [];
  private normalPriorityQueue: WorkerTask<T>[] = [];
  private lowPriorityQueue: WorkerTask<T>[] = [];
  private isProcessing: boolean = false;

  /**
   * Add a task to the scheduler
   */
  addTask(task: WorkerTask<T>, priority: 'high' | 'normal' | 'low' = 'normal'): void {
    switch (priority) {
      case 'high':
        this.highPriorityQueue.push(task);
        break;
      case 'normal':
        this.normalPriorityQueue.push(task);
        break;
      case 'low':
        this.lowPriorityQueue.push(task);
        break;
    }
    
    if (!this.isProcessing) {
      this.processQueue();
    }
  }

  /**
   * Process the task queue
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing) return;
    
    this.isProcessing = true;
    
    while (this.highPriorityQueue.length > 0 || 
           this.normalPriorityQueue.length > 0 || 
           this.lowPriorityQueue.length > 0) {
      
      // Process high priority first
      if (this.highPriorityQueue.length > 0) {
        const task = this.highPriorityQueue.shift();
        if (task) {
          await this.executeTask(task);
        }
        continue;
      }
      
      // Then normal priority
      if (this.normalPriorityQueue.length > 0) {
        const task = this.normalPriorityQueue.shift();
        if (task) {
          await this.executeTask(task);
        }
        continue;
      }
      
      // Finally low priority
      if (this.lowPriorityQueue.length > 0) {
        const task = this.lowPriorityQueue.shift();
        if (task) {
          await this.executeTask(task);
        }
        continue;
      }
    }
    
    this.isProcessing = false;
  }

  /**
   * Execute a single task
   */
  private async executeTask(task: WorkerTask<T>): Promise<void> {
    try {
      const result = await task.data;
      task.resolve(result);
    } catch (error) {
      task.reject(error instanceof Error ? error : new Error('Unknown error'));
    }
  }

  /**
   * Get queue statistics
   */
  getStats(): {
    highPriority: number;
    normalPriority: number;
    lowPriority: number;
    isProcessing: boolean;
  } {
    return {
      highPriority: this.highPriorityQueue.length,
      normalPriority: this.normalPriorityQueue.length,
      lowPriority: this.lowPriorityQueue.length,
      isProcessing: this.isProcessing,
    };
  }

  /**
   * Clear all queues
   */
  clear(): void {
    this.highPriorityQueue = [];
    this.normalPriorityQueue = [];
    this.lowPriorityQueue = [];
  }
}
