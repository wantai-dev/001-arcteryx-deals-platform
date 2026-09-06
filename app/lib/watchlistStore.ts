import type { WatchEntry } from './types';
import { parseStoredWatchEntries, WATCHLIST_STORAGE_KEY } from './watchlist';

export type WatchStorage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<unknown>;
};

export class WatchlistStore {
  private entries: WatchEntry[] = [];
  private hydrated = false;
  private hydration: Promise<void> | null = null;
  private queue: Promise<void> = Promise.resolve();
  private listeners = new Set<(entries: WatchEntry[], hydrated: boolean) => void>();

  constructor(private readonly storage: WatchStorage) {}

  snapshot() {
    return { entries: this.entries, hydrated: this.hydrated };
  }

  subscribe(listener: (entries: WatchEntry[], hydrated: boolean) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private publish() {
    for (const listener of this.listeners) listener(this.entries, this.hydrated);
  }

  hydrate() {
    if (!this.hydration) {
      this.hydration = this.storage.getItem(WATCHLIST_STORAGE_KEY)
        .then((raw) => {
          this.entries = parseStoredWatchEntries(raw);
        })
        .catch(() => {
          this.entries = [];
        })
        .finally(() => {
          this.hydrated = true;
          this.publish();
        });
    }
    return this.hydration;
  }

  mutate<T>(operation: (current: WatchEntry[]) => { entries: WatchEntry[]; value: T } | Promise<{ entries: WatchEntry[]; value: T }>) {
    const scheduled = this.queue.then(async () => {
      await this.hydrate();
      const update = await operation(this.entries);
      await this.storage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(update.entries));
      this.entries = update.entries;
      this.publish();
      return update.value;
    });
    this.queue = scheduled.then(() => undefined, () => undefined);
    return scheduled;
  }
}
