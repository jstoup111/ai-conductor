import { EventEmitter } from 'node:events';
import type { ConductorEvent } from '../types/index.js';

export type EventHandler = (event: ConductorEvent) => void;

export class ConductorEventEmitter {
  private emitter = new EventEmitter();

  emit(event: ConductorEvent): void {
    this.emitter.emit(event.type, event);
  }

  on(type: ConductorEvent['type'], handler: EventHandler): void {
    this.emitter.on(type, handler);
  }

  off(type: ConductorEvent['type'], handler: EventHandler): void {
    this.emitter.off(type, handler);
  }

  once(type: ConductorEvent['type'], handler: EventHandler): void {
    this.emitter.once(type, handler);
  }

  waitFor(type: ConductorEvent['type']): Promise<ConductorEvent> {
    return new Promise((resolve) => {
      this.once(type, resolve);
    });
  }
}
