import type { AgentEvent } from "./types.js";

export class EventBus {
  private listeners = new Set<(event: AgentEvent) => void>();

  emit(event: AgentEvent) {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  subscribe(listener: (event: AgentEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
