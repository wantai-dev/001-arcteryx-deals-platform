# TASK: GearDrop 聚合页与索引治理（更新：2026-09-07）

## Why（一句话）

让 GearDrop 以“可回答搜索需求的折扣聚合平台”被搜索引擎和 AI 正确理解，并把抓取资源集中到有完整、近期、可核验事实的页面。

## 当前状态：实现、合并、生产发布与线上验收完成

## 已确认事实

- 工作分支从 `origin/main` 的 `7c8c0f0d023e26308f39a24be8c3efbe24889f6d` 建立；来源：`git rev-parse origin/main`。
- `tools/generate_geo_catalog.py:171-187` 当前产品 sitemap 资格只覆盖 active、非退休来源和 SKU 去重，没有内容完整度与新鲜度门槛。
- `brands/arcteryx.html`、`brands/burton.html`、`brands/patagonia.html` 当前是核验说明页，主要 CTA 指向首页查询参数；来源：文件中的 `/?brand=...` 链接。
- `api/product.mjs:135-287` 已服务器渲染商品事实和 Product/Offer JSON-LD，但所有成功商品统一输出 `index,follow`，面包屑品牌链接指向首页筛选参数。
- `api/catalog.mjs` 已具备品牌、来源、地区、性别、分类、系列过滤和分页，可作为聚合页数据层。
- `sitemap.xml` 当前引用 static、products、insights 三个子 sitemap。
- 2026-09-07 真实目录发布构建读取 6,794 个活跃 URL；共享质量门选出 301 个商品 URL。来源：`node ops/data/build-data-release.mjs --output ...` 与生成后的 `catalog-status.json`。
- 301 个候选 URL 中，品牌/品类聚合展示按“品牌 + 标准化商品名”折叠地区报价；当前品牌页共有 194 个商品名称组（Arc'teryx 64、Burton 82、Patagonia 48）。来源：本地发布包 HTML 解析。
- readiness 对本地代码与真实数据发布包执行 294 项检查，失败 0 项。来源：`python3 tools/check_geo_readiness.py --dynamic-root ... --min-products 250`。
- PR #36 已 squash 合并到 `main`，合并提交为 `7d9ba92b9fda4aa9d1cd186459de14b93a8a78e1`；来源：`gh pr view 36 --json state,mergeCommit,mergedAt`。
- 生产代码发布、数据发布与 Nginx 路由已切换到上述实现。生产数据修订为 `e3ef16435ab519057f6a`，制品修订为 `e95275ec4235318dfa46`，活跃商品 URL 为 6,794；来源：`/srv/geardrop/data/status.json` 与线上 `publication.json`。
- 线上 readiness 于 2026-09-07 UTC 执行 294 项检查，失败 0 项；来源：`tools/check_geo_readiness.py --base-url https://geardrop.100app.dev --min-products 250`。
- IndexNow 已提交本次商品、聚合和洞察 URL，共 332 个 URL、1 批次，接口返回 HTTP 200；来源：生产服务器 `tools/notify_indexnow.py` 输出。

## 假设与发布约束

- 首批门槛采用折扣至少 45%、14 天内观察、来源最近 HTTP 200、完整名称/价格/币种/图片/来源 URL、活跃且非全尺码售罄。该门槛从当前字段计算，不需要数据库迁移。
- 品牌与分类页由数据发布任务生成静态 HTML，再由 Nginx 从不可变数据快照提供；不增加运行时聚合函数负担。
- sitemap 纳入表示建议抓取，不表示搜索引擎已收录，也不表示 AI 已提及、引用或推荐。
- 线上首次 readiness 出现 4 个“远端关闭连接”错误；四个 URL 随后直接读取均首次返回 200，完整重跑为 294/294，因此记录为瞬时传输波动，而非页面验收失败。

## 验收标准

1. 品牌聚合 URL 无 JavaScript 时包含统计、商品列表、可抓取分页、唯一 canonical/H1 与 CollectionPage/ItemList/BreadcrumbList JSON-LD。
2. 产品索引资格由共享纯函数决定；sitemap 与产品页 robots 使用同一规则，并输出可审计的排除原因统计。
3. 商品页品牌面包屑指向现有品牌聚合页。
4. 筛选查询参数不进入新增 sitemap；空聚合页和越界分页返回 `noindex,follow`。
5. 定向 Node/Python 测试、GEO readiness、真实本地 HTTP 渲染检查通过。
6. 经用户确认后发布生产，并以线上响应、生产修订状态和 IndexNow 返回值验收。

## 已完成且已验证

- 已建立隔离工作树 `/private/tmp/geardrop-seo-aggregation-20260907`，当前用户主工作树未改动。
- 新增共享索引政策和 JS/Python 对齐实现；商品 sitemap 与商品页 robots 使用同一门槛。
- 新增中英文品牌、品类聚合页、分页、结构化数据与 `sitemap-deals.xml`，并把首页、llms 与 IndexNow 纳入发现路径。
- 真实数据构建成功：6,794 个活跃 URL，301 个索引候选 URL，77 个发布文件。
- 变基到最新 `origin/main` 后，Node 全套测试 30/30；相关 Python 测试 40/40；语法检查和 `git diff --check` 通过。
- 临时隔离环境安装 `requirements.txt` 后，完整 Python 测试 261/261 通过；direct-server release 测试 2/2 通过。
- 从 Git 提交构建的代码发布包包含 43 个静态文件、29 个预压缩文件和新增共享索引运行时；从真实目录构建的数据发布包包含 77 个文件。
- 从提交版 product server 做真实 HTTP 抽样：候选商品返回 200、`index,follow` 且链接稳定品牌页；低置信商品返回 200、HTTP 与 HTML 双层 `noindex,follow`。
- 浏览器可访问结构与截图人工检查通过，确认页面首屏、事实边界、商品卡和下一页链接可用。
- 已合并 PR #36，并将代码提交 `7d9ba92b9fda4aa9d1cd186459de14b93a8a78e1` 发布到生产。
- 已生成并切换生产数据制品 `e95275ec4235318dfa46`，其 `CODE_REVISION` 与生产代码一致。
- 已安装新 Nginx 配置，`nginx -t` 成功，Nginx 与商品服务均为 `active`。
- 线上完整 readiness 为 294/294；商品 sitemap 共 301 个唯一 URL，目录状态的 index-ready 数量同为 301。
- 抽检 sitemap 首、中、尾商品均返回 200、`index,follow`、正确 canonical；排除样本 `backcountry:bur02hl` 返回 HTTP 与 HTML 双层 `noindex,follow`。
- 旧域名对新增分页聚合路径返回 308，并保留路径与查询参数。
- IndexNow 已接收 332 个 URL，HTTP 200。

## 后续观察

1. 由 Google/Bing 自主抓取与评估 301 个候选商品 URL；sitemap 和 IndexNow 不构成收录保证。
2. 后续用 Search Console、Bing Webmaster Tools 和实际 AI 问答样本分别衡量收录、点击与被引用情况，避免把技术就绪度当成可见度结果。

## 死路

- 无。
