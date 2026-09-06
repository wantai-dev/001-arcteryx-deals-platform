import { computeSignal, groupHistoryBySku } from './signals';
import type { DealSignal, PriceHistoryRow, Product } from './types';

/** Coalesce overlapping requests and discard responses from before a refresh. */
export class SignalLoader {
  private generation = 0;
  private complete = new Set<string>();
  private pending = new Map<string, Promise<void>>();

  constructor(
    private read: (ids: string[]) => Promise<PriceHistoryRow[]>,
    private publish: (signals: Record<string, DealSignal>) => void,
  ) {}

  reset() {
    this.generation++;
    this.complete.clear();
    this.pending.clear();
  }

  async ensure(items: Product[]): Promise<void> {
    const unique = [...new Map(items.map((item) => [item.sku_id, item])).values()];
    const waiting = unique.map((item) => this.pending.get(item.sku_id)).filter((job): job is Promise<void> => Boolean(job));
    const fresh = unique.filter((item) => !this.complete.has(item.sku_id) && !this.pending.has(item.sku_id));
    if (fresh.length) {
      const generation = this.generation;
      const work = Promise.resolve().then(() => this.read(fresh.map((item) => item.sku_id))).then((rows) => {
        if (generation !== this.generation) return;
        const grouped = groupHistoryBySku(rows);
        const next: Record<string, DealSignal> = {};
        for (const item of fresh) {
          next[item.sku_id] = computeSignal(item, grouped.get(item.sku_id) || []);
          this.complete.add(item.sku_id);
        }
        this.publish(next);
      }).catch((error) => {
        if (generation === this.generation) throw error;
      }).finally(() => {
        if (generation === this.generation) fresh.forEach((item) => this.pending.delete(item.sku_id));
      });
      fresh.forEach((item) => this.pending.set(item.sku_id, work));
      waiting.push(work);
    }
    await Promise.all(waiting);
  }
}
