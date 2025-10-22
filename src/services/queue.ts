import { EventEmitter } from "events";

export class InProcessQueue<T> extends EventEmitter {
  private q: T[] = [];
  enqueue(item: T) {
    this.q.push(item);
    this.emit("enqueued", item);
  }
  dequeue(): T | undefined {
    return this.q.shift();
  }
  size(): number {
    return this.q.length;
  }
}
