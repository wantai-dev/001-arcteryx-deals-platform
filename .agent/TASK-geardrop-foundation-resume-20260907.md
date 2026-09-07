# TASK: GearDrop 1.2 基础偏好、Paywall 与发布资料收尾（更新：2026-09-07）

## Why（一句话）

在不改版本号和不执行生产写入的边界内，消除 GearDrop 1.2 偏好状态、付费权益文案与发布校验中的已知缺陷，交付可由根任务验收和上线的独立提交。

## 当前状态：实现与本地集成验证完成，等待根任务真机/商店资产验收

## 已确认事实

- 指定分支为 `codex/geardrop-foundation-resume-20260907`，基线为 `4e3c5b7`，开工时工作区干净。（来源：`git status --short --branch`、`git log -1 --oneline`）
- 仓库没有 `.codegraph/`。（来源：`test -d .codegraph` 输出 `NO_CODEGRAPH`）
- `app/AGENTS.md` 要求改代码前阅读精确 Expo SDK 57 文档；已读取 `https://docs.expo.dev/versions/v57.0.0/`。（来源：本会话官方文档读取）
- 版本冻结：本子任务不改 `app.json` 与 `package.json` 的版本/build。（来源：根任务工单）
- 根任务随后将 1.2.0 / Build 12 冻结在 `codex/geardrop-release-20260907`；本分支实现提交后合并该候选再跑最终发布校验。（来源：根任务消息与本地 ref `4e45144`）

## 假设

- 低风险验收标准采用：偏好定向测试、配置/元数据脚本、TypeScript 检查，以及相关文件静态核对；若完整验证受其他并行改动影响，明确拆分报告。

## 已完成且已验证

- 偏好存储保留 `all` 地区，读取失败不会发布默认值，Me 显示错误与重试；汇率缓存读取捕获错误，原币显示仍加载 FX，原币切 CNY 的 cached/live 状态有单测覆盖。
- Paywall 只列 12 个月历史、无限提醒、无限关注三项 Pro 权益，五语说明明确史低信号、摘要、筛选免费。
- RevenueCat 权益与 offerings 独立结算；恢复购买区分无记录与服务失败；已购用户从 Me 进入 RevenueCat 管理 URL 或 Apple 订阅入口；StoreKit `P1W` 试用按结构化周期解析为 7 天。
- Me 补齐“跟随系统”、版本/build 页脚及语言、外观、市场、通知控件的辅助功能角色、标签和选择状态；移除会把中文 `de` 强制大写的样式。
- 五语类别补齐 `other` 与 `泳装`，产品历史范围和图表低点改为真实的 12 个月/区间语义。
- 合并 `codex/geardrop-release-20260907` 后，`npm run verify` 在 1.2.0 / Build 12 上通过：129 tests / 129 pass、config、release assets、五语 metadata、typecheck、Expo Doctor 20/20、实时汇率、实时数据（6793 products / 100478 history / 1352 accepted Yearbook rows）与 iOS export（1534 modules，HBC 5.6 MB），最终输出 `verify_local_ok`。
- `npm run verify:store-screenshots` 在最终集成上按预期退出 1，并逐项列出全部 30 张缺失截图。

## 下一步

1. 交给根任务做真机/CUA 偏好持久化、全部地区、CNY、辅助功能和原生 StoreKit 验收。
2. 生成并签核 5 语 × 6 张商店截图后重跑截图硬门。

## 死路

- 商店截图硬门当前缺 5 个语言 × 6 张 iPhone 6.9 英寸截图，共 30 张；不得绕过。
- Web 环境不能验证原生 StoreKit/RevenueCat 管理链接与恢复购买结果，需在真实 iOS 购买环境验收。
