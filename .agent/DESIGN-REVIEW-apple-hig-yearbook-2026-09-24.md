# GearDrop · Apple HIG 评审与图鉴修复（2026-09-24）

范围：`app/`（Expo 57 / RN 0.86 / expo-router）。三个议题——参考 Apple Design 优化、图鉴无图与排序组织、菜单语言。

验证方式：`npx tsc --noEmit`、`npm test`（180 通过）、`expo start --web` 实跑真实 Supabase 数据（1482 条现行款 / 1116 条历史款，美国市场），以及一次 iPhone 17 Pro 模拟器上的原生 Debug 构建实跑。本机环境限制与绕行方式见「三之二」。

---

## 一、事实与量化（本次实测）

| 事实 | 数值 | 来源 |
| --- | --- | --- |
| 现行款目录规模 | 1482 条 active | `catalog_products` REST 计数 |
| 历史款（未匹配折扣分组） | 1116 组（美国市场） | 跑 `indexYearbookDeals` + `groupYearbookArchive` |
| 历史款卡片**可用真实图片** | 1116 / 1116 = **100%** | offer 的 `image_url` / `images` |
| 现行款卡片可用真实图片（美国） | 346 / 1482 = **23.3%** | 仅限匹配到在售 deal 的型号 |
| 官方品类 slug 种类 | 144 种 | 目录去重 |
| **缺失五语翻译的 slug** | 9 种 × 5 语言 = 45 个缺口，影响 150 条 | `localizedCategory` 实跑 |
| **`kids` 性别标签** | 五种语言全部漏译，影响 147 条 | `localizedGender` 实跑 |
| 年份分布 | 2026 占 1428/1482 = 96.4% | `season_codes` 解析；498 条无季节码 |

---

## 二、已修复

### 1. 图鉴无图

官方目录按设计**不存图片 URL**（`catalog/README.md`：“Descriptions, image URLs/files… are deliberately not stored”），所以图鉴此前一律画 SVG 剪影。本次改为复用已经在「折扣」页使用的经销商图片：

- 新增 `app/components/CatalogPhoto.tsx`：剪影垫底 + `expo-image` 覆盖 + 逐个候选 URL 失败回退。
- 新增 `lib/yearbook.ts#offerImageUris`：从关联 offer 收集 HTTPS 图片、去重。
- 历史款卡片 **100% 上图**；现行款中已关联折扣的型号上图（美国市场 23.3%）。

**剩余 76.7% 的现行款仍是剪影**，要补齐必须改数据层，见第四节。

### 2. 排序与组织

| 问题 | 修复 |
| --- | --- |
| 默认按英文名 A–Z 平铺 1482 条，三品牌混排 | 新增默认排序「按品牌分组」（品牌 → 品类 → 名称），列表按品牌插入分组标题行 |
| `numColumns={2}` 无法插入整行标题 | 改为自建行模型（`buildRows`），单列 `FlatList` 渲染 |
| 历史款下「最新年份」是死选项（`sortArchive` 不处理，静默退化为按名称） | 历史款排序表只给 4 项；切换 scope 时不适用的排序自动回落 |
| 分段控件写死总数（`现行款 1482`），与筛选结果不一致 | 分段控件去掉数字，下方单独一行显示随筛选变化的结果数 |
| 筛选表 144 个品类按字母排，无数量 | 按数量降序 + 显示数量；品牌/性别/年份同样带数量 |
| 同一概念的单复数 slug 各占一格（`base-layer` / `baselayers` 都叫「基础层」，各筛一半） | 按本地化标签合并，选中时匹配整组 slug；选项 144 → 138，重复标签 0。实测「基础层」由 23 + 18 合并为 41，筛选结果正好 41 |
| 无品类的 10 条排在每个品牌最前 | `compareCategory` 把空品类排到最后 |
| 年份筛选在 96% 为 2026 时仍占一栏 | 只有存在多个年份时才显示该栏 |

### 3. 菜单语言

- `kids` 补齐五语（`Kids` / 童款 / Kinder / Enfant / キッズ）。此前所有语言的筛选菜单都显示原始键 `kids`。
- 补齐 9 个官方 slug 的五语翻译：`1-2-zips`、`1-4-zips`、`crew-necks`、`full-zips`、`long-sleeve-shirts`、`long-sleeve-t-shirts`、`polo-shirts`、`short-sleeve-shirts`、`short-sleeve-t-shirts`。此前菜单里直接显示 `short-sleeve-t-shirts` 这样的原文 slug。
- `localizedCategory` 增加兜底：未知 slug 转 Title Case，不再把 kebab-case 泄漏进界面。
- 兜底会让原来的守卫（字符串相等判断）失效，因此 `scripts/verify-live-data.ts` 的检查改为基于 `hasLocalizedCategory` 的键存在性，并新增性别标签的同类检查。
- 新增 `app/__tests__/i18n.test.ts`。

### 4. Apple HIG 已落地部分

- **Tab bar 高度**：原先写死 `height: 78 / paddingBottom: 20`。无 Home Indicator 的机型多出约 20pt 死区，有 Home Indicator 的机型（inset 34）又压住指示条。改为 `50 + insets.bottom`，`paddingBottom: insets.bottom || 6`。
- **字重字号**：图鉴页原本几乎全是 `fontWeight: "900"`（SF Pro Black，iOS 系统界面基本不用）和 13.5 / 10.5 / 9.5 这类非标准字号。改为 700/600 为主，字号对齐 iOS 档位（28 / 22 / 17 / 15 / 13 / 12 / 11）；排序表行文字改 17pt（iOS 列表 Body）。
- **Sheet 行为**：排序表和型号详情表加上 grabber（拖动条），点击背后遮罩可关闭。
- **触感反馈**：切换分段、选排序、选筛选、收藏均加 `Haptics.selectionAsync()`（`lib/actions.ts#selectionTick`）。
- **命中区域**：收藏按钮从贴边 `top:3/right:3` 改为 `top:6/right:6` + `hitSlop`。
- **动态字体**：对易截断文本加 `maxFontSizeMultiplier` 上限，避免大字号下标题/徽章破版。
- **列表性能**：`initialNumToRender` / `maxToRenderPerBatch` / `windowSize` / `removeClippedSubviews`（上图后尤其必要）。

---

## 三、Apple HIG 第二轮：②③④ 已完成

### ② 统一排版体系（原「其余屏幕仍是 900 字重」）

`lib/theme.ts` 新增 `text` tokens —— Apple iOS 默认字号档下的 17 种文字样式（largeTitle / title1-3 / headline / body / callout / subhead / footnote / caption1-2，各带 emphasized 变体），含 HIG 的行高。

全量替换完成，覆盖 `index.tsx`、`me`、`watchlist`、`yearbook`、`product/[skuId]`、`paywall`、`privacy`，以及 `DealCard`、`FilterChips`、`FilterSheet`、`MarketSheet`、`MarketPill`、`ControlRow`、`ActiveChips`、`SearchField`、`ScreenState`、`AlertModal`、`PriceChart`、`ProGate`、`DefaultImage`。

结果：**`fontWeight: 800/900` 从 48+29 处降到 0**；11.5 / 10.5 / 9.5 / 14.5 / 13.5 / 12.5 / 9 这些非标准字号全部清除。

### ③ 原生 Large Title

`(tabs)/yearbook`、`watchlist`、`me` 由单文件改为目录路由，各自带一个 `_layout.tsx`（共享 `components/LargeTitleStack.tsx`）。路由路径不变，`/product/[skuId]` 仍在根 Stack，因此详情页照旧盖住 Tab Bar。

标题从列表头移进导航栏（`<Stack.Screen options>`），图鉴的 MarketPill 成为 `headerRight`。iOS 上 `headerLargeTitleEnabled` 提供系统级的大标题滚动折叠。

一处取舍：最初用了 `headerTransparent: true` + `headerBlurEffect`，让内容滚到毛玻璃导航栏下方。但那个布局依赖 `contentInsetAdjustmentBehavior`（仅 iOS），在 web 预览里内容直接压到导航栏底下 —— 实测可见。既然本机无法做 iOS 上的最终确认，就改成不透明导航栏：所有平台布局都正确，iOS 的大标题折叠照常。

「折扣」页保留品牌 lockup、不加大标题 —— 那是品牌决策，不是 HIG 问题，没有替你改。

### ④ Sheet：detents + 下拉关闭 + grabber

新增 `components/Sheet.tsx`，替换全部 7 处手写 Modal（图鉴排序表/型号详情表、FilterSheet、MarketSheet、AlertModal、折扣页排序表、我的页选择器）。提供：

- **detents**：按屏幕高度比例给多个停靠高度，拖动时吸附。筛选表 0.55/0.9，市场表 0.6/0.9，型号详情 0.6/0.9；短表（排序、语言选择）用自适应内容高度。
- **下拉关闭**：拖过阈值或快速下滑甩出即关闭，向上超出最高档有橡皮筋阻尼。
- **grabber**、**点遮罩关闭**、**先播退场动画再卸载**（型号详情表改为 `visible` + `onClosed` 两段式，右上角 ✕ 和遮罩现在动画一致）。

两个实现取舍：
1. 没有走 `presentation: 'formSheet'` 路线（那才是真正的 `UISheetPresentationController`）。要那样得把 5 个表改成路由，而型号详情表依赖图鉴屏幕的本地 catalog state，得先把目录提升成 context —— 属于架构级改动。当前实现用 `Animated` + `PanResponder`，无新依赖、不动导航结构，拿到 detents / 拖动关闭 / grabber 的行为，但不是系统原生 sheet 控件。
2. detent sheet 的内容高度跟随可见高度动画 —— 否则在中档时底部固定的按钮行会被推到屏幕外（这个我在 web 预览里实测到了并修掉）。代价是 sheet 动画走 JS driver 而非 native driver。

拖拽数学抽成 `lib/sheetGesture.ts` 并配了 8 个单测。**这批测试当场抓到一个真 bug**：关闭阈值原本从「最高档」而不是「最低档」算起，导致从中档往下拖 12pt 就会关闭。已修。

### ① Dynamic Type

前提先说清楚：RN 的 `<Text>` 默认 `allowFontScaling: true`，字号和行高**本来就跟随系统文字大小**。所以缺的不是「字会不会变大」，而是**字变大以后盒子跟不跟得上**。缺口全在布局侧。

新增 `lib/typeScale.ts`：

- `scaleLength(value, fontScale, { max, damping })` —— 按阻尼（默认 0.75）放大固定尺寸并封顶（默认 1.8×）。文字继续按系统 1–3.1× 缩放，容器只补上行高多出来的那部分，44pt 的点击区不会变成 136pt。
- `isAccessibilityScale(fontScale)` —— 1.35 以上即 iOS 的无障碍档。
- `gridColumns(fontScale)` —— 无障碍档下卡片网格收成单列（Apple 的建议是收列，而不是让每列窄到读不了商品名）。
- `TYPE_CAP` —— 三档 `maxFontSizeMultiplier`（badge 1.5 / compact 1.8 / standard 2.4），替掉上一轮我随手写的 1.2/1.3/1.4 字面量。

落地范围：

| 位置 | 修复 |
| --- | --- |
| 折扣页 / 图鉴双列网格 | 无障碍档收成单列（`FlatList` 换 `key` 才接受新的列数；图鉴的自建行模型按 `columns` 分组） |
| 图鉴卡片预留的两行标题框 | `minHeight: 40` 改为跟随字号放大 |
| Tab Bar | 高度从 `50 + inset` 改为 `scaleLength(50) + inset`，并显式开 `tabBarAllowFontScaling` |
| 分段控件 | 固定 `height: 44` 会裁字，改为跟随字号 |
| 排序/筛选/市场/语言选择等表内行、chip、按钮 | `minHeight` 全部跟随字号 |
| 「我的」设置行 | 无障碍档下标签与取值**改为上下堆叠**（iOS 设置就是这么做的），否则一行挤不下 |
| Sheet detents | 无障碍档下丢掉中间档、直接开到最大档，避免开在被裁掉的内容上 |
| 关注列表行、商品详情按钮、Paywall 套餐行、搜索框、ActiveChips | `minHeight` 跟随字号；chip 的关闭图标也跟着放大 |
| 单行易截断文本（品类、信号、徽章） | 按 `TYPE_CAP` 分档封顶，不再一刀切 |

注意 `minHeight` 是下限不是上限，所以行本身永远不会裁掉文字；真正会裁的是写死的 `height:`，那几处（分段控件、Tab Bar、ControlRow 的方形按钮）已逐个改掉。纯图标按钮（关闭、返回、收藏）保留 44pt，那已经是最小点击区。

`lib/typeScale.ts` 配 7 个单测：默认档不动、小字档不缩、放大但比文字慢、封顶、NaN/Infinity 不产生 NaN 布局、收列阈值、三档 cap 的排序。

**在模拟器上实测到并修掉的一个问题**：把系统文字调到最大无障碍档（AccessibilityXXXL）后，「折扣」页顶部的市场胶囊被撑出屏幕右侧、文字被裁成「US · LOCA」，并把品牌 logo 挤出了这一行。已给胶囊加上 `flexShrink` + 单行截断 + badge 档封顶，给 logo 容器加 `flexShrink: 0`。重跑后胶囊完整显示在屏内。

截图证据：`.agent/geardrop-dynamic-type-ax5-2026-09-24.png`（AccessibilityXXXL 下的折扣页：网格已收成单列、Tab Bar 与标签同步放大、搜索框/排序行/筛选按钮均已放大、市场胶囊不再溢出）。


### 仍未处理

1. **深色模式下图片区仍是浅色**（`photo` / `photoTopo` / `onPhotoBadge` 在 darkTokens 与浅色一致）。
3. **分段控件选中态无过渡动画**。
4. **web 端 `<button>` 嵌套告警**（既有问题，iOS 无影响）。

---

## 三之二、验证与本机环境限制（重要）

已验证：
- `npx tsc --noEmit` 通过；`npm test` **180 项全过**（新增 i18n 4 项、sheetGesture 8 项、yearbook 图片/品类 3 项）。
- **原生 iOS**：Debug 构建成功，装进 iPhone 17 Pro 模拟器（iOS 26.5）实跑，加载 Metro 与真实 Supabase 数据，无崩溃，折扣页渲染正常（截图留档）。
- **web 预览**（真实数据）：图鉴/关注/我的三个页面路由改造后正常；标题进入导航栏、MarketPill 在 headerRight；筛选表在中档打开且底部按钮行可见；点遮罩关闭生效；品类合并、计数、分组标题、排序项均正确。

未能验证，以及原因：
- **Dynamic Type 在图鉴/关注/我的三页以及各 Sheet 里的实际观感**：这三页和表单用的是同一套 `typeScale` 助手，但本机没法点 Tab 切页（原因见下），只在「折扣」页看到了 AccessibilityXXXL 的真实渲染。
- **iOS 大标题的滚动折叠动画**：是 iOS 原生行为，web 预览渲染的是 JS 近似 header，看不到折叠。
- **Sheet 的真实手势**（拖动吸附/甩出关闭）：本机无法给模拟器发送点击/触摸 —— 这台 Xcode 安装里**没有 Simulator.app GUI**（`/Applications/Xcode.app/Contents/Developer/Applications/` 不存在），设备只能用 `simctl` 无头启动；而 react-native-web 的 PanResponder 对 CDP 合成鼠标拖拽无响应。因此手势逻辑改为用 `lib/sheetGesture.ts` 的纯函数单测覆盖，手势接线本身只经过代码审查。

本机构建 iOS 需要的三处绕行（都在 gitignore 的 `app/ios/` 内，不影响仓库，但 `pod install` 后会失效）：
1. `xcode-select` 指向 CommandLineTools。用 `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer` 绕过；Claude Code 的 iOS Simulator 集成不认这个变量，要用需要你执行 `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`。
2. **仓库路径含空格**（`hermes projects`）导致两个脚本阶段失败：`expo-constants` 的 `get-app-config-ios.sh` 调用、以及主 target 的 `Bundle React Native code and images`，两处都把路径展开成未加引号的参数。已在生成的 pbxproj 里加引号绕过。这是上游 bug，EAS 云端构建不受影响，但**任何本机 iOS 构建都会踩到**。
3. 本机 `pod install` 生成的 `Pods-GearDrop-frameworks.sh` 漏掉 `React.framework`，app 启动即 dyld 崩溃（你贴的那份崩溃报告）。手工把 framework 复制进 .app 后正常。

## 四、需要决策：现行款剩余 77% 的图片

要让全部 1482 条现行款都有官方图，只有一条路：

1. 给 `catalog_products` 加 `image_url`（及可选 `images`）列 —— 新增一个 migration；
2. `catalog/official_catalog.py` 不再丢弃图片 URL（Burton / Patagonia 是 Shopify `products.json`，图片就在同一份响应里；Arc'teryx feed 同理，所以采集侧几乎零成本）；
3. 重跑一次完整三品牌同步；
4. 改 `catalog/README.md` 里“图片 URL 刻意不存储”的记录，以及 `app/lib/supabase.ts` 的 `YEARBOOK_COLUMNS`、`normalizeCatalogProduct` 的契约校验。

这会推翻一条已写入文档的设计决策（很可能是出于版权/存储考虑），且要动生产数据管线，**未擅自执行**。如果确认要做，我按上述顺序实施。
