// Binary min-heap keyed by `arrivesAt` (or any numeric `at`).
export interface QueuedEvent {
  at: number;
  run: () => void;
}

export class EventQueue {
  private heap: QueuedEvent[] = [];

  get size(): number {
    return this.heap.length;
  }

  push(ev: QueuedEvent): void {
    this.heap.push(ev);
    this.bubbleUp(this.heap.length - 1);
  }

  peek(): QueuedEvent | undefined {
    return this.heap[0];
  }

  pop(): QueuedEvent | undefined {
    if (this.heap.length === 0) return undefined;
    const top = this.heap[0];
    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.bubbleDown(0);
    }
    return top;
  }

  private bubbleUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.heap[parent].at <= this.heap[i].at) break;
      [this.heap[parent], this.heap[i]] = [this.heap[i], this.heap[parent]];
      i = parent;
    }
  }

  private bubbleDown(i: number): void {
    const n = this.heap.length;
    for (;;) {
      let smallest = i;
      const l = 2 * i + 1;
      const r = 2 * i + 2;
      if (l < n && this.heap[l].at < this.heap[smallest].at) smallest = l;
      if (r < n && this.heap[r].at < this.heap[smallest].at) smallest = r;
      if (smallest === i) break;
      [this.heap[smallest], this.heap[i]] = [this.heap[i], this.heap[smallest]];
      i = smallest;
    }
  }

  /** Drain all events with at <= simNow, up to `maxCount`. Returns overflow count deferred. */
  drainUpTo(simNow: number, maxCount: number): number {
    let drained = 0;
    while (drained < maxCount) {
      const top = this.peek();
      if (!top || top.at > simNow) break;
      this.pop();
      top.run();
      drained++;
    }
    return this.size;
  }
}
