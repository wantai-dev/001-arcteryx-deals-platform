import type { ChartPoint, DealSignal, PriceHistoryRow, Product } from './types';
import { formatPrice } from './catalog';

export function historyToPoints(rows: PriceHistoryRow[], current?: Product | null) {
  const byDay = new Map<string, ChartPoint>();

  const sorted = [...rows].sort((a, b) => Date.parse(a.recorded_at || '') - Date.parse(b.recorded_at || ''));
  for (const row of sorted) {
    const day = (row.recorded_at || '').slice(0, 10);
    const sale = Number(row.sale_price || 0);
    if (!day || !Number.isFinite(Date.parse(row.recorded_at || '')) || !Number.isFinite(sale) || sale <= 0) continue;
    if (current && row.currency && row.currency !== current.currency) continue;
    byDay.set(day, {
      day,
      sale,
      original: Number(row.original_price || 0),
    });
  }

  if (current?.sale_price) {
    const day = (current.last_updated || new Date().toISOString()).slice(0, 10);
    byDay.set(day, {
      day,
      sale: current.sale_price,
      original: current.original_price,
    });
  }

  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
}

export function recentPoints(points: ChartPoint[], days: number) {
  const cutoff = Date.now() - days * 86400000;
  return points.filter((point) => {
    const stamp = Date.parse(`${point.day}T00:00:00Z`);
    return !Number.isNaN(stamp) && stamp >= cutoff;
  });
}

export function computeSignal(product: Product, historyRows: PriceHistoryRow[], nowMs = Date.now()): DealSignal {
  const validRows = historyRows.filter((row) => {
    const stamp = Date.parse(row.recorded_at || '');
    const price = Number(row.sale_price);
    return Number.isFinite(stamp) && stamp <= nowMs && Number.isFinite(price) && price > 0
      && (!row.currency || row.currency === product.currency);
  }).sort((a, b) => Date.parse(a.recorded_at!) - Date.parse(b.recorded_at!));
  const historyOnly = historyToPoints(validRows, null);
  const points = historyToPoints(validRows, product);
  const current = product.sale_price;

  if (!Number.isFinite(current) || current <= 0 || historyOnly.length < 2 || points.length < 2) {
    return {
      kind: 'insufficient',
      label: '',
      tone: 'neutral',
      verdict: 'Not enough price history yet',
      isLow: false,
      minPrice: null,
      pointCount: historyOnly.length,
    };
  }

  // Chart points contain each day's closing observation. The low must include
  // every observation, including a cheaper price earlier on the same day.
  const minAll = Math.min(current, ...validRows.map((row) => Number(row.sale_price)));
  const ninety = validRows.filter((row) => Date.parse(row.recorded_at!) >= nowMs - 90 * 86400000);
  const min90 = ninety.length ? Math.min(current, ...ninety.map((row) => Number(row.sale_price))) : minAll;

  if (current <= minAll) {
    return {
      kind: 'all_time_low',
      label: 'All-time low',
      tone: 'success',
      verdict: 'Good time to buy: at the observed all-time low',
      isLow: true,
      minPrice: minAll,
      pointCount: points.length,
    };
  }

  if (current <= min90) {
    return {
      kind: 'ninety_day_low',
      label: '90-day low',
      tone: 'success',
      verdict: 'At the 90-day low; older prices were lower',
      isLow: true,
      minPrice: minAll,
      pointCount: points.length,
    };
  }

  const currentStamp = Date.parse(product.last_updated || '');
  const today = new Date(nowMs);
  today.setHours(0, 0, 0, 0);
  let runStarted = currentStamp;
  let previousPrice: number | null = null;
  for (const row of [...validRows].reverse()) {
    const stamp = Date.parse(row.recorded_at!);
    if (stamp > currentStamp) continue;
    const price = Number(row.sale_price);
    if (Math.abs(price - current) <= 0.001) runStarted = Math.min(runStarted, stamp);
    else { previousPrice = price; break; }
  }
  if (Number.isFinite(currentStamp) && currentStamp <= nowMs && runStarted >= today.getTime()
    && previousPrice !== null && current < previousPrice) {
    const delta = previousPrice - current;
    return {
      kind: 'drop_today',
      label: `↓ ${formatPrice(delta, product.symbol)} today`,
      tone: 'success',
      verdict: 'Often cheaper — consider waiting',
      isLow: false,
      minPrice: minAll,
      pointCount: points.length,
      dropAmount: delta,
    };
  }

  return {
    kind: 'steady',
    label: 'Steady',
    tone: 'neutral',
    verdict: 'Often cheaper — consider waiting',
    isLow: false,
    minPrice: minAll,
    pointCount: points.length,
  };
}

export function groupHistoryBySku(rows: PriceHistoryRow[]) {
  const grouped = new Map<string, PriceHistoryRow[]>();
  for (const row of rows) {
    if (!row.sku_id) continue;
    const list = grouped.get(row.sku_id) || [];
    list.push(row);
    grouped.set(row.sku_id, list);
  }
  return grouped;
}
