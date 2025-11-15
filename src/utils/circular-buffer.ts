/**
 * Circular Buffer implementation for bounded log storage
 * Prevents memory leaks by maintaining a fixed-size buffer that overwrites old entries
 */
export class CircularBuffer<T> {
  private buffer: T[];
  private writeIndex: number = 0;
  private size: number = 0;
  private readonly capacity: number;

  constructor(capacity: number) {
    if (capacity <= 0 || !Number.isInteger(capacity)) {
      throw new Error('Capacity must be a positive integer');
    }
    this.capacity = capacity;
    this.buffer = new Array(capacity);
  }

  /**
   * Add an item to the buffer
   * If buffer is full, overwrites the oldest item
   */
  push(item: T): void {
    this.buffer[this.writeIndex] = item;
    this.writeIndex = (this.writeIndex + 1) % this.capacity;

    if (this.size < this.capacity) {
      this.size++;
    }
  }

  /**
   * Get all items in insertion order
   */
  getAll(): T[] {
    if (this.size < this.capacity) {
      // Buffer not full yet, return items from start to writeIndex
      return this.buffer.slice(0, this.size);
    } else {
      // Buffer is full, return items in correct order
      return [
        ...this.buffer.slice(this.writeIndex),
        ...this.buffer.slice(0, this.writeIndex)
      ];
    }
  }

  /**
   * Get the last N items
   */
  getLast(count: number): T[] {
    const all = this.getAll();
    return all.slice(-count);
  }

  /**
   * Clear all items
   */
  clear(): void {
    this.buffer = new Array(this.capacity);
    this.writeIndex = 0;
    this.size = 0;
  }

  /**
   * Get current number of items
   */
  length(): number {
    return this.size;
  }

  /**
   * Get maximum capacity
   */
  getCapacity(): number {
    return this.capacity;
  }

  /**
   * Check if buffer is full
   */
  isFull(): boolean {
    return this.size === this.capacity;
  }

  /**
   * Check if buffer is empty
   */
  isEmpty(): boolean {
    return this.size === 0;
  }

  /**
   * Get item at index (in insertion order)
   */
  get(index: number): T | undefined {
    if (!Number.isInteger(index) || index < 0 || index >= this.size) {
      return undefined;
    }

    if (this.size < this.capacity) {
      return this.buffer[index];
    } else {
      const actualIndex = (this.writeIndex + index) % this.capacity;
      return this.buffer[actualIndex];
    }
  }

  /**
   * Filter items and return matching ones
   */
  filter(predicate: (item: T, index: number) => boolean): T[] {
    return this.getAll().filter(predicate);
  }

  /**
   * Map over items
   */
  map<U>(mapper: (item: T, index: number) => U): U[] {
    return this.getAll().map(mapper);
  }

  /**
   * ForEach over items
   */
  forEach(callback: (item: T, index: number) => void): void {
    this.getAll().forEach(callback);
  }
}
