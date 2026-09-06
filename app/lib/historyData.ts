import type { PriceHistoryRow } from './types';

export type HistoryPageRequest = { skuIds: string[]; from: number; to: number; sinceIso?: string; throughIso: string };
export type HistoryPageReader = (request: HistoryPageRequest) => Promise<PriceHistoryRow[]>;

/** Read every page: a partial history must never be treated as all-time evidence. */
export async function loadCompleteHistory(
  skuIds: string[], readPage: HistoryPageReader, sinceIso?: string,
  throughIso = new Date().toISOString(),
): Promise<PriceHistoryRow[]> {
  const ids = [...new Set(skuIds.filter(Boolean))];
  const rows: PriceHistoryRow[] = [];
  for (let index = 0; index < ids.length; index += 45) {
    const batch = ids.slice(index, index + 45);
    for (let page = 0; ; page++) {
      if (page >= 100) throw new Error('Price history exceeded the completeness limit.');
      const data = await readPage({ skuIds: batch, from: page * 1000, to: page * 1000 + 999, sinceIso, throughIso });
      rows.push(...data);
      if (data.length < 1000) break;
    }
  }
  return rows;
}
