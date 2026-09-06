export type NotificationRoute = { pathname: '/product/[skuId]'; params: { skuId: string } } | '/watchlist';

export function notificationRoute(data: Record<string, unknown> | undefined): NotificationRoute | null {
  const skuId = data?.skuId;
  if (typeof skuId === 'string' && skuId.trim() === skuId && skuId.length > 0 && skuId.length <= 512
    && !/[\u0000-\u001f\u007f]/u.test(skuId)) {
    return { pathname: '/product/[skuId]', params: { skuId } };
  }
  return data?.url === '/watchlist' ? '/watchlist' : null;
}
