# TASK: GearDrop 非品牌意图答案页（更新：2026-09-08）

## Why（一句话）

让 GearDrop 对“户外折扣聚合、跨商家价格历史、跨地区比价、Patagonia 降价提醒”四类非品牌问题提供可抓取、可引用且不夸大能力的中英答案，从而提升搜索与 AI 候选集覆盖。

## 当前状态：实现与验收完成，Draft PR #38 待审阅；生产未发布

## 已确认事实

- 当前隔离工作树基于 `origin/main@aca19eb`，分支为 `codex/geardrop-geo-intent-pages-20260908`；来源：本轮 `git fetch origin`、`git worktree add` 输出。
- 公共知识页以 `geo/site-content.json` 为内容正本，由 `tools/build_geo_content.py::build_outputs` 生成 HTML、`llms.txt`、`llms-full.txt`、`sitemap-static.xml`、`sitemap.xml` 和 `robots.txt`；来源：本轮亲读 `tools/build_geo_content.py:556-573`。
- 生成页已统一输出 index/follow、self-canonical、zh-CN/en-US/x-default hreflang、Organization/WebSite/SoftwareApplication/页面/Breadcrumb JSON-LD；来源：本轮亲读 `tools/build_geo_content.py:146-222,315-414`。
- 动态品牌与品类聚合页由 `tools/generate_geo_catalog.py::render_deal_hub` 生成，并会覆盖代码仓库中的品牌模板；来源：本轮亲读 `tools/generate_geo_catalog.py:894-1008` 与 `build_outputs:1167-1201`。
- 当前 iPhone App 源码与元数据明确包含价格历史、收藏和价格提醒；免费/Pro 边界、后台时机和实时性都有保守说明；来源：本轮 `rg` 命中 `app/lib/historyData.ts`、`app/lib/priceAlerts.ts`、`app/store-metadata/next-version.json`。
- 2026-09-08 基线中，ChatGPT 非品牌自然提及为美国 1/10、中国 0/10；缺口集中在本任务四类意图；来源：主工作区 `.agent/TASK-indexing-visibility-followup-2026-09-08.md` 与最终报告。

## 假设

- “开始优化”本阶段先落实站内内容、结构化数据、内链与 discovery 文件，并准备可审阅分支；生产发布作为独立最终动作，在本地和浏览器验收通过后再执行。
- 四组答案页各生成 zh-CN 与 en-US 一页，共 8 个新 canonical URL；不写实时商品数量，不声称 GearDrop 获得品牌授权、搜索收录或 AI 推荐。

## 验收标准

1. 8 个页面均由同一内容正本可重复生成，包含直接回答、来源/时间边界、适用场景、操作步骤、FAQ 与下一步链接。
2. 每组页面具备 reciprocal hreflang、self-canonical、index/follow、Article/Question/Breadcrumb 等 JSON-LD，并进入 `sitemap-static.xml`、`llms.txt`、`llms-full.txt`。
3. 现有核心知识页与动态品牌/品类聚合页能发现新专题，Patagonia 聚合页优先链接提醒专题。
4. `python3 tools/build_geo_content.py --check`、定向单测、全量 Python 测试通过。
5. 本地 HTTP + 桌面/手机浏览器验收 8 页：HTTP 200、无控制台错误、无横向溢出、导航与语言切换可用。
6. 提交前 `git diff --check` 通过，提交仅包含本任务代码、内容、生成物、测试和任务档案。

## 已完成且已验证

- 已从最新 `origin/main` 建立隔离工作树，未碰主工作区的未提交文件。
- 已定位静态知识页与动态聚合页的两条生成链。
- 已新增 `geo/intent-pages.json`，包含四组中英双语意图页；`tools/build_geo_content.py` 以 additive module 方式合并内容，并对未知注入目标与重复路径 fail closed。
- 已生成 8 个新 HTML canonical，并同步改写 15 个既有知识页、`llms.txt`、`llms-full.txt` 与 `sitemap-static.xml`；`python3 tools/build_geo_content.py --check` 原文为 `GEO content is current (28 generated files).`。
- 首页与现有知识页已链接四组新主题；`tools/generate_geo_catalog.py` 让数据发布时生成的品牌/品类首页也链接四组主题，Patagonia 品牌页的专题区优先提醒页。
- `tools/check_geo_readiness.py` 已将 8 个 URL 纳入持续生产审计；本地静态层叠最小动态快照运行结果为 `passed=358 / failed=0 / total=358`，并保留 `observed_ai_visibility=not_measured` 边界。
- 定向 `test_geo_assets.py` 为 `Ran 23 tests ... OK`；全量 Python 为 `Ran 270 tests ... OK`。
- 本地 Chrome 浏览器验收覆盖 8 页 × 桌面/手机共 16 个组合：HTTP 状态仅 200、最大横向溢出 0、console/page error 0、每页 1 个可解析 JSON-LD 块且 Article 含 3 个 Question；从这些页面发现的 25 个站内链接在叠加动态快照后全部返回 200。证据在本工作树 `.agent/browser-qa/`，不纳入代码提交。
- 目检发现旧 `.link-list a` 触控规则使卡片标题与说明横排，已在 `assets/geo.css` 修为纵向排列并重新验收。
- 实现提交为 `f869da0510590eeacd9fcde470090be075e19983`，已推送到 `wantai-dev` 私有仓库分支 `codex/geardrop-geo-intent-pages-20260908`；Draft PR 为 `https://github.com/wantai-dev/001-arcteryx-deals-platform/pull/38`，创建后回读为 `OPEN / draft / mergeStateStatus=CLEAN`。
- 已从实现提交构建代码发布包：`static_files=51 / compressed_files=37`；发布包内 8 个新页面逐一存在，均含 `index,follow` 和 JSON-LD。生产未发布，未声称收录、排名或 AI 可见度已改善。

## 下一步（按序）

1. 用户审阅 Draft PR #38，并决定是否进入生产发布。
2. 如获发布指令，先同步最新 `origin/main`、复验并合并 PR，再通过正式 OCI 发布入口部署同一提交。
3. 发布后运行公网 readiness、8 页桌面/手机抽样与 sitemap 读回，并提交 IndexNow 发现通知；这些回执不能改写成已收录或 AI 可见度增长。

## 死路

- 主工作区停在较旧提交且含大量未跟踪文件，不适合直接编辑；已改用基于最新 `origin/main` 的隔离工作树。
- 首轮纯静态 HTTP 链接检查发现 4 个 404，均为 `generate_geo_catalog.py` 在数据发布阶段生成的 catalog/insights 页面；已在独立临时根生成 28 个最小动态产物并叠加复测，25/25 站内链接均为 200。该首轮结果不作为产品缺陷。
