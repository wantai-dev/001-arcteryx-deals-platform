# TASK: GearDrop 1.2 提醒与详情质量收尾（更新：2026-09-07）

## Why（一句话）

让 GearDrop 1.2 的提醒、关注列表和商品详情在币种、目录歧义、通知时序、错误反馈与五语布局上保持真实且可验证。

## 当前状态：实现完成，等待主任务集成共享文案与验证器更新

## 已确认事实

- 工作树分支为 `codex/geardrop-alerts-resume-20260907`，起点 `4e3c5b7`，开工时 `git status --short --branch` 无文件改动。（来源：2026-09-07 本会话命令输出）
- `app/AGENTS.md` 要求写代码前读取 Expo 57 精确版本文档。（来源：`app/AGENTS.md`）
- Expo 57 `expo-localization` 提供同步 `getLocales()`，首项是系统最高优先语言；Android 前台恢复时可重读。（来源：https://docs.expo.dev/versions/v57.0.0/sdk/localization/）
- Expo 57 `expo-notifications` 的本地通知使用 `scheduleNotificationAsync`；权限通过 `getPermissionsAsync`/`requestPermissionsAsync` 获取。（来源：https://docs.expo.dev/versions/v57.0.0/sdk/notifications/）
- CodeGraph CLI 回报本工作树没有 `.codegraph/` 索引，因此后续按仓库规则使用 `rg`。（来源：`codegraph explore ...` 输出）

## 假设（未验证；验证后移入上区）

- iOS 原生界面在五种语言、动态字号、窄屏和 VoiceOver 下的最终视觉与交互表现仍需真机或模拟器检查；本任务按要求未使用 CUA 或生产环境。

## 已完成且已验证

- 已读取长任务协议、设计规范、Expo 57 Localization 与 Notifications 文档。
- 混合币种最低价比较过滤无效/过期价格与过期汇率，并允许 EUR 原值参加 EUR 基准比较。
- 型号候选解析区分目录歧义拒绝与目录中不存在的老款回退，mapper 不再恢复被目录拒绝的 SKU。
- 系统语言从 `expo-localization.getLocales()` 解析；新增带尾随检查的单飞执行器，保存本机提醒后立即触发前台检查。
- SKU 邮件保存统一调用真实 upsert；失败清理使用 draft 全字段条件匹配，不覆盖稍后的用户编辑或投递状态。
- 提醒面板、Watchlist 和详情补齐删除失败反馈、邮件独立订阅说明、类别占位图、长名称布局及关键辅助功能标签。
- 商品详情使用 Pro 365 天/免费 30 天图表，保留完整历史用于信号；修正折扣、换算说明、跨区报价来源、缺汇率表述、购买来源与底部安全区。
- 10% 预设按币种法定小数位舍入（USD 49.95→44.96、USD 0.5→0.45、JPY 4995→4496）。
- `npm ci`：added 624 packages；`npm run typecheck`（最近一次界面小改前）退出 0；定向测试 42/42；`npm test` 135/135。
- `git diff --check` 退出 0，且 `app/lib/i18n.ts` 无本任务差异。
- `npm run verify:config` 唯一失败为共享验证器仍要求 `_layout.tsx` 出现 `router.replace('/watchlist')`；当前共享实现自 `e06cbee` 起经 `notificationRoute(data)` 路由。已交由主任务/foundation 更新断言。

## 下一步（按序）

1. 对最后的详情换算显示小改重跑 typecheck 与定向测试。
2. 提交本任务差异；共享 `i18n.ts` 文案和 `verify-config.ts` 更新由 foundation 集成。
3. 主任务合并后重跑全量校验并做 iOS 真机/模拟器五语检查。

## 死路

- 给定评审文件名 `DESIGN-REVIEW-round1.md` 不存在；已定位真实文件 `DESIGN-REVIEW-round1-2026-09-04.md`。
- CodeGraph CLI 无可用索引，未自行初始化。
