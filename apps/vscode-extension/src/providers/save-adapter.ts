/**
 * ImpactRefreshScheduler (v0.6.3 plan §9).
 *
 * Aggregates saves into one refresh: a Set of pending relative paths,
 * a debounce window, and a single in-flight refresh. Events that arrive
 * while a refresh is running are accumulated and drained afterwards —
 * never dropped (plan §9.4).
 */
export class ImpactRefreshScheduler {
  private readonly pending = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private inFlight = false;

  constructor(
    private readonly refresh: (files: string[]) => Promise<void> | void,
    private readonly debounceMs = 400,
  ) {}

  /** Record a saved file and schedule a (re-)drain. */
  push(filePath: string): void {
    this.pending.add(filePath);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.drain();
    }, this.debounceMs);
  }

  pendingCount(): number {
    return this.pending.size;
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private async drain(): Promise<void> {
    if (this.inFlight) return; // the running drain will pick up pending
    this.inFlight = true;
    try {
      while (this.pending.size > 0) {
        const batch = [...this.pending];
        this.pending.clear();
        await this.refresh(batch);
      }
    } finally {
      this.inFlight = false;
      // Saves that arrived during the last await re-scheduled a timer;
      // if none is pending, make sure anything left still drains.
      if (this.pending.size > 0 && this.timer === undefined) {
        this.timer = setTimeout(() => {
          this.timer = undefined;
          void this.drain();
        }, this.debounceMs);
      }
    }
  }
}
