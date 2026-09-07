# TASK: GearDrop 聚合页与索引治理（更新：2026-09-07）

## Why（一句话）

让 GearDrop 以“可回答搜索需求的折扣聚合平台”被搜索引擎和 AI 正确理解，并把抓取资源集中到有完整、近期、可核验事实的页面。

## 当前状态：本地实现与验收完成，等待生产发布确认

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

## 假设与发布约束

- 首批门槛采用折扣至少 45%、14 天内观察、来源最近 HTTP 200、完整名称/价格/币种/图片/来源 URL、活跃且非全尺码售罄。该门槛从当前字段计算，不需要数据库迁移。
- 品牌与分类页由数据发布任务生成静态 HTML，再由 Nginx 从不可变数据快照提供；不增加运行时聚合函数负担。
- 尚未在生产 Nginx 上执行 `nginx -t` 或部署验收；本机没有 Nginx 二进制，生产发布属于独立硬停动作。
- sitemap 纳入表示建议抓取，不表示搜索引擎已收录，也不表示 AI 已提及、引用或推荐。

## 验收标准

1. 品牌聚合 URL 无 JavaScript 时包含统计、商品列表、可抓取分页、唯一 canonical/H1 与 CollectionPage/ItemList/BreadcrumbList JSON-LD。
2. 产品索引资格由共享纯函数决定；sitemap 与产品页 robots 使用同一规则，并输出可审计的排除原因统计。
3. 商品页品牌面包屑指向现有品牌聚合页。
4. 筛选查询参数不进入新增 sitemap；空聚合页和越界分页返回 `noindex,follow`。
5. 定向 Node/Python 测试、GEO readiness、真实本地 HTTP 渲染检查通过。
6. 不部署生产；发布是独立的最终动作。

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

## 下一步（按序）

1. 等待用户确认后，才执行推送与生产部署。
2. 生产顺序：先发布代码但暂不切 Nginx 动态聚合路由；运行数据同步生成新快照；安装并 `nginx -t` 验证配置；原子切换并 reload；最后执行线上 readiness、抽样 URL 与 IndexNow 验收。

## 死路

- 无。
