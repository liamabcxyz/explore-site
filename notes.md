# VANTAGE 改造笔记

记录每一步对 fork 自 `OvertureMaps/explore-site` 的这个仓库做了什么改动、为什么这么改。按时间顺序追加，不回头改写历史条目（除非发现之前记错了）。

参考文档（不在本仓库里，是设计阶段的输入）：产品规划 TPM 文档、技术设计 SWE 文档、explore-site 改造清单。实施计划见 `~/.claude/plans/soft-prancing-spindle.md`（本机路径，不随仓库走）。

---

## 0. 仓库建立

- `gh repo fork OvertureMaps/explore-site --clone=false` fork 到 `liamabcxyz/explore-site`，再 `git clone` 到本地工作目录。
- **原理**：改动都在自己的 fork 上做，不碰上游；MIT 协议允许随意改。
- 环境问题：系统自带的 `git`（Xcode Command Line Tools 里的桩程序）因为 `CoreDevice`/`Mercury` framework 损坏而崩溃，`gh` 也没装。用 `brew install git gh` 解决，装的是 git 2.55.0 / gh 2.98.0，走 `/opt/homebrew/bin`。
- Node 版本：`package.json` 里 Volta 锁定 `24.19.0`，但本机是 Node 22.13.0。检查过 `package.json` 没有 `engines` 硬性约束，所以没有额外装 Node 24，直接用现有的 22.13 —— 这是一个可回退的判断，如果后续遇到诡异的兼容性问题，第一个该怀疑的就是这个版本差异。
- 验证：`npm install`（含 `postinstall` 跑 `scripts/copy-maplibre-assets.mjs`，把 MapLibre 的 worker/wasm 静态资源拷进 `public/`）、`npm test` 基线 **12 个 suite / 649 个 test 全过**、`npm run dev` 用 Playwright 截图确认旧金山金融区的真实 Overture 建筑数据渲染出来了（`localStorage['overture-stac-cache']` 也确认写入，证明 STAC → PMTiles 的解析链路真的跑通了，不是空数据）。

---

## 1. 精简（Trim）—— 移除 VANTAGE 不需要的功能

**为什么先做这一步**：explore-site 是一个通用的 Overture 数据浏览器，VANTAGE 只需要"地图渲染 + 建筑图层"这一层地基。把不需要的功能先清掉，一是减少后续改动时的心智负担和误改风险，二是能尽早验证"精简后地图和建筑图层还能正常工作"这件事——这是后面所有工作的前提。

### 1A. 移除 nav 工具栏里的下载/搜索/分享/多语言/品牌相关组件

删除的文件：
- `components/nav/DownloadButton.jsx` + `.css`、`DownloadDialog.jsx`（数据下载功能，VANTAGE 用户不需要下载 geo 数据）
- `components/nav/SearchBox.jsx`（地名搜索）
- `components/nav/LanguageSwitcher.jsx` + `.css`（地图标签多语言切换）
- `components/nav/ShareButton.jsx`、`GithubButton.jsx`、`OvertureWordmark.jsx`、`TermsOfUse.jsx`（Overture 官方品牌/外链，fork 出来的产品不该指向上游仓库的 GitHub issue 页或品牌标识）
- `lib/DownloadCatalog.js`、`lib/zipDownload.js`、`lib/downloadMetadata.js`（DownloadButton 的支撑逻辑，没有其他调用方）
- 对应测试：`__tests__/DownloadDialog.test.js`、`zipDownload.test.js`、`downloadMetadata.test.js`

`components/nav/Header.jsx` 重写为一个极简标题栏：`VANTAGE` 标题 + 地球投影切换按钮（globe toggle，保留，是通用地图功能不是 Overture 品牌相关）+ 深色模式切换（`DarkModeToggle`，保留）。

`app/page.jsx` 联动清理：
- 去掉 `TermsOfUse` 的引用和渲染。
- 去掉传给 `Header` 的 `setZoom`、`visibleTypes`、`language`、`setLanguage`、`activeFeature`、`onGersSelect` —— 这些 prop 在 Header 精简后已经没有消费者了（原本分别是给 DownloadButton / ShareButton / LanguageSwitcher / SearchBox 用的）。
- `language` state 本身保留（因为 `MapView` 还在用它做标签渲染），但 `setLanguage` 已经没有 UI 能触发了（`LanguageSwitcher` 没了），改成 `const [language] = useState("mul")` 去掉死掉的 setter。

**原理**：能明确判断"只服务于某个被删组件、且没有其他调用方"的 state/prop 就一起删；不确定是否还被其他地方用到的（比如 `visibleTypes`、`pendingFeature` 这些同时驱动 `Map`/`LayerTree` 的），保留不动——精简阶段的原则是"删除确定死掉的代码"而不是"顺手做架构清理"，避免在验证阶段引入不必要的回归面。

验证：`npm test`（9 suite / 582 test 过，比基线少的 3 个 suite 正是删掉的下载相关测试文件）、`npm run build` 通过。

### 1B. 移除 `inspector_panel`（要害检查面板）

删除整个 `components/inspector_panel/` 目录（`InspectorPanel.jsx`、`NestedPropertyRow.jsx`、`TableRow.jsx`、`ThemePanel.jsx`、`ThemeIcon.jsx`、`SourcesRow.jsx`、`TipLibrary.jsx`、`config/ThemeRegistry.js`、`utils/` 等）。

`components/SidePanel.jsx` 里原来 `activeTab === "features"` 分支渲染 `<InspectorPanel .../>`，现在换成一个占位文案"Analysis coming soon"。

**原理**：这是本次改造里"替换点"最明确的一处——inspector_panel 是"点一个要素、弹出它所有原始字段"的通用调试面板，VANTAGE 要的是"点一个位置、看可见度分析结果 + 剖面图"的 `ProfilePanel`（计划里的 Phase 4）。两者渲染的插槽（`SidePanel.jsx` 里 `activeTab === "features"` 这个分支）完全一样，所以先占位、等算法和 UI 都做出来了再原地替换，中间不需要经过"先删完全、再从零建一个新 tab"的弯路。

**踩到的坑**：`components/FeatureSelector.jsx`（点击处有多个重叠要素时弹出的"选择一个"popup，这是地图点击/inspect 流程的一部分，**不在**本次删除范围内）也从 `inspector_panel/ThemeIcon.jsx` 引入图标，删除整个目录后编译报 `Module not found`。处理方式：把 `ThemeIcon.jsx` 原样搬到 `components/ThemeIcon.jsx`（提升为顶层共享组件，因为它现在服务于两个独立的消费者，不再是 inspector_panel 私有的），修正 `FeatureSelector.jsx` 的 import 路径。

**原理**：删除一个目录前，除了看"这个目录导出了什么"，还要反向 grep 谁在 import 这个目录下的具体文件——目录级别的功能归属（"inspector_panel 是要删的检查面板"）和文件级别的复用关系（"ThemeIcon 这个小图标组件被隔壁保留的组件也用了"）是两回事,不能只看整体定性就下手删。

对应测试删除：`__tests__/inspectorUtils.test.js`、`__tests__/themeRegistry.test.js`（后者是编译后二次运行测试才暴露的遗漏，指向了已删除的 `inspector_panel/config/ThemeRegistry.js`）。

验证：`npm test`（7 suite / 572 test 过）、`npm run build` 通过。

---

## 2. 撤销精简 —— 恢复所有原生功能

**决策变化**：产品/技术设计文档是在还不知道 `explore-site` 这个具体仓库存在的情况下写的，很多设想的功能边界是"猜的"，不是"看过代码之后定的"。用户明确表态：还在重新评估范围，先别删任何原生功能，之前设想要砍掉的下载/分享/多语言/搜索/检查面板，可能有些本来就有用，或者可以直接成为 VANTAGE 功能的一部分（比如 inspector_panel 能看到原始 `height`/`min_height` 字段，对调试真实建筑数据很有用）。

**怎么撤销的**：因为 1A/1B 的所有改动都还没有 `git commit`，直接 `git checkout HEAD -- <文件列表>` 把所有被删的文件、被改的文件（`app/page.jsx`、`components/FeatureSelector.jsx`、`components/SidePanel.jsx`、`components/nav/Header.jsx`、`package-lock.json`）一次性恢复到 clone 下来时的原始状态，同时删掉了之前为了修复 `FeatureSelector.jsx` 引用而新建的 `components/ThemeIcon.jsx`（因为 `inspector_panel/ThemeIcon.jsx` 原路径已经随目录一起恢复回来了，不再需要那个临时的顶层副本）。

**原理**：这提前验证了一个假设——因为改动没有提交，"删除"这个动作在 git 里始终是可逆的，回退成本几乎为零。这也是为什么 Phase 1 每一步都要求"改完立刻 `npm test && npm run build`"而不是攒一堆改动最后再测：验证链条越短，回退决策越轻松。

**验证**：`npm test`（12 suite / 649 test，回到跟 Phase 0 完全一致的基线）、`npm run build` 通过。

**现状**：仓库回到 clone 下来时的原始状态，只多了 `notes.md`（以及 Next.js 自动生成的 `AGENTS.md`/`CLAUDE.md`，不是我写的）。之前"精简"这个方向暂停，等用户想清楚 VANTAGE 到底要在 explore-site 的哪些功能基础上叠加、哪些真的不需要，再决定要不要重新做、做多少。

---

## 4. 按 v0.2 范围重新精简 —— 只删 Download + inspector_panel

用户看过第 3 节的核实结果后确认：以 PRD/工程设计 v0.2 为准继续。v0.2 明确的删除范围只有三样：数据下载功能、`inspector_panel`（替换为分析面板）、explore/inspect 左右对比滑动。其余原生功能（搜索、分享、多语言、深色模式、书签/Navigator、Overture 品牌链接）全部保留 —— 这是对第 2 节"撤销精简"决定的延续，不是推翻。

**具体删除的文件**：`components/nav/DownloadButton.jsx`+`.css`、`DownloadDialog.jsx`、`lib/DownloadCatalog.js`/`zipDownload.js`/`downloadMetadata.js`、对应 3 个测试文件；整个 `components/inspector_panel/`、对应 2 个测试文件（`inspectorUtils.test.js`、`themeRegistry.test.js`）。

**联动改动**：
- `components/nav/Header.jsx`：去掉 `DownloadButton` 的 import/JSX，以及只有它在用的 `setZoom` prop。`OvertureWordmark`、`GithubButton`、`ShareButton`、`LanguageSwitcher`、`SearchBox`、globe 切换、`DarkModeToggle` 全部原样保留。
- `app/page.jsx`：去掉传给 `Header` 的 `setZoom`（唯一消费者是被删的 `DownloadButton`）。
- `components/SidePanel.jsx`：`activeTab === "features"` 分支的 `InspectorPanel` 换成占位文案，留给 Phase 4 的 `ProfilePanel` 原地替换。
- 老问题重演一次：`components/FeatureSelector.jsx`（点击处多要素时的选择弹窗，**不在**删除范围内）从 `inspector_panel/ThemeIcon.jsx` 引入图标 —— 同第 1B 节的处理方式，把 `ThemeIcon.jsx` 提升为 `components/ThemeIcon.jsx` 共享组件。

**验证**：`npm test`（7 suite / 572 test）、`npm run build` 通过。

**待办（还没做，且范围待重新确认）**：

- 对比滑动（explore/inspect 左右分屏）的移除 —— v0.2 明确要删，但这是 `MapView.jsx`（740 行）里最核心的架构决定（双 map 实例、`sliderPosition` state、`initialSlider` prop、`page.jsx` 里的 URL 同步逻辑都绑在这上面），影响面比前两项大得多，先不动，留作单独一步仔细做，不跟这次的"快速删除"混在一起。
## 5. Phase 2 —— 算法模块（纯函数，合成数据单测，还没接地图）

这是全项目唯一没有旧代码可抄的部分，直接照技术设计文档 §3.1–3.5 的公式写，字段名用第 3 节核实过的真实 Overture 字段。全部是纯函数，不 import 任何 MapLibre/React 的东西，输入输出都是普通对象/数组——这样测试不需要跑地图、跑浏览器，`npm test` 几十毫秒内出结果。

**新增文件**：

- `lib/geo/toLocalMeters.js` —— `makeLocalProjector(originLat, originLng)`，等距圆柱投影（equirectangular），返回 `{toLocal, toLatLng}` 一对互逆函数。城市街区尺度内精度足够（这点误差比建筑高度数据本身的不确定性小得多）。
- `lib/geo/normalizeBuilding.js` —— 两个函数：
  - `normalizeBuilding(properties, footprint)`：高度回填三级链（`height` 直接用 → `num_floors × 3.2m` → 按 `class` 查默认值表 → 兜底 10m），**加了第 3 节发现的修正**：`@height_source` 不是现成置信度，所以额外做了一张 `HEIGHT_SOURCE_CONFIDENCE` 映射表（目前只有 `"OpenStreetMap": "medium"` 一条，因为目前只实测见过这一个取值），只会把"有 height 字段"这一档从 high 降到 medium，不会因为查不到映射表就升级成 high。
  - `selectOccludingFeatures(buildingFeatures, buildingPartFeatures)`：原样照搬 `components/map/layers/explore/buildings/{building,building-part}/extrusion.json` 里的过滤规则——`is_underground` 的都不参与遮挡计算；`building` 里 `has_parts=true` 的不用它自己的多边形（它没有真实几何），改用它对应的 `building_part` 子要素。这条规则是从渲染层的真实过滤条件反推出来的，不是我猜的。
- `lib/viewshed/sightline.js` —— `intersectSegmentBuilding(observer, target, building)`：用标准的线段-线段求交公式，遍历建筑外环的每一条边，收集所有交点的参数 t，取最小值为 `tEntry`（离观察者最近的近侧面）。**关键推导**：因为视线高度 z(t) 沿线段单调递增，`req`（这栋楼要求的最低目标高度）只取决于 tEntry 这一个点，不用管 tExit——这就是为什么公式里只有一个 t，不是我漏看了什么。`computeMinAlt` 取所有相交建筑里 `req` 的最大值，无相交时返回 `-Infinity`（不是特殊哨兵值需要额外判断，`-Infinity <= 任何有限数` 这个比较本身就是对的，`fractionVisible` 的边界检查会直接把它解释成"完全可见"）。
- `lib/viewshed/scoring.js` —— `fractionVisible(minAlt, targetHeight, shellRadius)` 完整实现并测了边界值；`angleScore`/`distScore`/`openness`/`score` 按计划只定义签名、内部 `throw`，因为这几个只有推荐排名 UI 需要，`openness` 产品文档里也没给出精确公式，没有验证对象之前不猜。
- `lib/viewshed/computeViewshed.js` —— 以发射点为局部坐标原点，在 `analysisRadius` 范围内按 `gridSpacing` 撒网格点，每个点算一次 `frac`，输出**点要素**（不是面要素/网格多边形）——先用最简单、肯定对的形式，要不要在地图上渲染成方块/圆点是 UI 层的事，算法不需要替 UI 决定。命名上特意把"烟花球半径"叫 `shellRadius`、"网格撒点半径"叫 `analysisRadius`，因为技术设计文档原文把两者都叫"radius"，这是一个真实存在、迟早会踩到的歧义。
- `lib/viewshed/worker.js` —— 目前只是薄薄一层 `postMessage`/`onmessage` 包装，还没被任何地方 import（Phase 4/5 接 UI 时才会用 `new Worker(new URL(...), import.meta.url)` 这种写法接进去）。

**已知的简化，不是 bug**：
- `intersectSegmentBuilding` 只做"视线穿过建筑外环边界"的求交，不做完整的点在多边形内判断——如果观察者或发射点恰好落在某栋建筑的多边形内部且视线完全不穿过任何一条边，会被当成"没相交"。这种情况现实中不会发生（没人会把观察点设在建筑物内部），先不处理。
- 忽略多边形的内环（洞，比如内院天井）——判断"这栋楼挡不挡视线"只关心它的外轮廓，洞不影响这个判断。
- 不考虑 `min_height`（建筑底部离地高度，比如骑楼、天桥这种悬空结构）对遮挡的影响——技术设计文档给的公式本来就没考虑这个，`normalizeBuilding` 算出了 `base` 字段但 `sightline.js` 目前没用它，先保持跟文档公式一致。

**测试**：新增 5 个测试文件（`toLocalMeters`/`normalizeBuilding`/`sightline`/`scoring`/`computeViewshed`），27 个用例，全部用手算验证过期望值（比如 `req = z0 + (height-z0)/tEntry` 这种直接代公式反推构造测试数据，不是先跑代码再拿输出当预期值）。`npm test`：12 suite / 599 test 全过。`npm run build` 也确认过，新文件不影响构建。

**下一步**：Phase 3——接旧金山真实建筑数据，把 `querySourceFeatures` 拿到的真实 feature 灌进 `selectOccludingFeatures` → `normalizeBuilding` → `computeViewshed`，手工核对 1-2 个真实地点的遮挡结果是否符合常识。

---

## 6. Phase 3 + 4（部分）—— 接真实数据 + 点地图选发射点，直接在地图上看结果

用户看完纯算法的单元测试后追问"能跑起来看看吗"，进一步明确：不要控制台调试，要**直接在地图上点选发射点、直接在地图上看到可见度结果**；排名/推荐功能明确不需要。这把原计划里 Phase 3（接真实数据，原本设计成一个临时的、console 触发的调试钩子）和 Phase 4（正式交互 UI）的一部分合并成一步直接做完。

**新增文件**：

- `lib/geo/overtureBuildingAdapter.js` —— `buildingsFromMapFeatures(buildingMapFeatures, buildingPartMapFeatures)`：把 `map.querySourceFeatures()` 返回的原始要素（`{properties, geometry}` 形状）适配成 `normalizeBuilding()` 要的输入。顺手处理了一个 Phase 2 没考虑到的真实情况——**建筑要素的 geometry 可能是 MultiPolygon**（一条记录里有多块不连续的体量），这种要拆成多个独立的"建筑"分别参与遮挡判断，不能当成一整块处理。配套测试 `__tests__/overtureBuildingAdapter.test.js`，3 个用例。
- `components/launch/LaunchPointControl.jsx` —— 真正的交互组件：一个按钮进入"点地图放置发射点"模式，放置后出现高度/烟花半径两个滑杆，地图上画一个 marker，旁边实时渲染一层用 `circle` 图层表示的可见度网格（红=挡住、绿=看得见，插值上色）。

**架构上的一个判断**：这个组件完全没有改 `MapView.jsx`（740 行、状态最复杂的文件）一行代码。做法是通过已有的 `lib/MapContext.js`（`useMapInstance()`）拿到地图实例，自己注册一个独立的 `map.on("click", ...)` 监听器、自己管理状态、自己加图层——跟 `MapView.jsx` 内部原有的点击查要素逻辑完全并行、互不干扰。挂载点只有一处：`app/page.jsx` 里 `<MapContext.Provider>` 内加一行 `<LaunchPointControl />`。**代价**：现在点击地图放置发射点时，如果正好点在一栋建筑上，`MapView.jsx` 自己的"点击查看要素"逻辑也会同时触发，侧边栏会跟着弹出来（截图里能看到"Analysis coming soon"占位面板一起弹出了）。这是刻意接受的一个小瑕疵，不是没发现——真要处理需要往 `MapView.jsx` 的点击处理器里塞一个外部标志位，动它的核心状态机，跟"最小改动验证通路"这个目标不划算，先留着。

**踩到的一个真 bug，而不是设计取舍**：第一次实现后，图层加进去了、`querySourceFeatures` 也确认真的返回了 2154 个算好 `frac` 的网格点，但地图上**完全看不到任何色点**。排查过程：查 `map.getStyle().layers` 数组，发现自己加的图层排在 `divisions-*-label` 这些标签图层**前面**——也就是说 `MapView.jsx` 自己异步加载 PMTiles 之后再调用的 `addAllLayers()`（一次性加大约 100 个图层）比这个组件的图层注册时机晚，把新加的 ~100 个图层全部叠在了我这一层**上面**，直接把它盖住了。MapLibre 加图层默认插到数组末尾（=最上层），谁后加谁在上面，这是先后时序问题，不是画错了坐标或颜色。**修法**：每次发射点/参数变化重新计算后,顺手 `map.moveLayer(LAYER_ID)`(不带第二个参数,效果是"挪到最顶层"),不去跟 `MapView.jsx` 的加载时序死磕——用户真正会看结果的时机(刚点完发射点、刚拖完滑杆)恰好也是"该露出来"的时机,两者对上了。

**验证**（Playwright 实测，旧金山金融区）：点击"Set launch point"→ 点地图上一个真实坐标 → 3 秒内地图上出现约 2150 个红绿网格点，`frac` 取值范围 0~1（不是全红或全绿的退化结果），证明"真实建筑数据 → 算法 → 地图渲染"这条完整链路是通的。截图存档在这次会话记录里，没有存进仓库（不是仓库该管的产物）。

**已知的粗糙点，留给之后**：
- 每次只在放置/调整发射点参数时重新查询建筑数据，**平移地图不会刷新**——如果用户把地图挪到别处再挪回来，用的还是当初那个视口范围内查到的建筑，不是最新的。
- 网格计算目前在主线程跑（`lib/viewshed/worker.js` 还没接进来）。当前每次点击后只算一次，不是拖动滑杆时连续算，所以暂时感觉不到卡顿；`onChangeCommitted`（拖完松手才触发，不是拖动过程中连续触发）已经按之前的判断做了防抖处理，为以后接 Worker 的时机把关（真正需要 Worker 的时间点是"拖动滑杆时要求近乎实时刷新",目前还没做那一步)。
- 输出目前是散点(每个网格格子一个点),不是文档设想的"色块拼接的等值区域图"——先用最简单、肯定对的形式验证链路,视觉效果留到之后再打磨。
- 排名/推荐功能——用户已明确说不需要,维持 Phase 2 里"只定义函数签名、内部 throw"的状态,不实现。

## 3. 核实 PRD/工程设计 v0.2（基于源码重写的新版设计文档）

用户带来了两份新文档(PRD v0.2、工程设计 v0.2),自称"基于实际阅读 explore-site 源码"重新校准。这两份文档比 v0.1 具体很多——直接点出了 Overture buildings 主题的真实字段名,并据此重新设计了 `normalizeBuilding()` 该怎么写。因为算法模块还没动工,这些字段名对不对是能不能开始写 Phase 2 的前提,所以没有直接采信,而是拿本地这份真实仓库 + 真实运行时数据核对了一遍。

**核对方法**:仓库里 `lib/map-styles/tiles.json`(内容和 `components/map/tiles.json` 一致,标注 `$release: "2026-02-18.0"`)本身就是 PMTiles 的字段 schema 清单;另外起了本地 dev server,用 Playwright 在旧金山金融区实际跑了 `map.querySourceFeatures()`,把真实建筑要素的字段值抓出来看。

**确认为真**(v0.2 文档说对了):
- `building` 图层字段确实包含:`height`、`min_height`、`num_floors`、`num_floors_underground`、`min_floor`、`is_underground`、`has_parts`、`class`、`subtype`、`roof_height`、`roof_shape`、`@height_source`、`@geometry_source` 等——逐一在 `tiles.json` 里核实过,不是文档瞎编的。
- `building_part` 是独立的 source-layer(z8–14),确实**没有** `class`/`subtype`/`has_parts` 字段(这几个只属于父 `building`)——文档里"必须同时查两个 source-layer"的结论成立。
- 高度回填字段用 **`num_floors`**(不是 v0.1/OSM 习惯的 `building:levels`)——这个纠正是对的,写 `normalizeBuilding()` 时要用这个字段名。

**需要修正一处**(v0.2 文档没说准的地方):
- `@height_source` 确实存在,但实测取值是 **`"OpenStreetMap"`** 这样的数据来源名称字符串,不是"high/medium/low"这种现成的置信度分级。也就是说,这个字段能帮我们判断"这个高度是从哪个底层数据集来的",但**"来源名 → 置信度等级"这张映射表还是要我们自己设计**(比如"OpenStreetMap 的高度多为用户手填,给中等置信度"这种规则),不是拿来直接用的现成置信度字段。工程设计 v0.2 里"直接用 `@height_source` 做置信度信号"这句话要按这个理解修正,不是"不用算,官方帮你分好级了"。

**发现一个更重要的、文档里没有的问题**——`queryRenderedFeatures` 在实测中不可靠:
文档(工程设计 v0.2 第 3.4 节)非常确定地说"路径 A(`queryRenderedFeatures`)已经在跑,是确定选项"。但实测在旧金山金融区、zoom 16.5、建筑图层 `visibility` 确认是 `"visible"` 的情况下,`map.queryRenderedFeatures({layers:["buildings-building-extrusion"]})` **返回 0 条**,而同一时刻 `map.querySourceFeatures('buildings', {sourceLayer:'building'})` **返回 707 条**(`building_part` 另有 401 条)。也就是说图层数据确实加载了,只是"渲染命中测试"这条路径没查到东西,原因还没查清楚(可能跟这个仓库用的 globe 投影、或者无头浏览器的 WebGL 渲染管线有关,还没验证是否是 Playwright headless 特有的问题,真实浏览器里要再测一次)。

**结论/待办**:Phase 3 实现"从地图拿真实建筑数据"这一步,**先按 `querySourceFeatures` 设计,而不是盲目照抄文档里"路径 A = queryRenderedFeatures"的结论**——`querySourceFeatures` 目前实测更可靠,还顺带不受 UI 图层开关状态影响(算法不应该依赖用户有没有勾选某个图层)。等真正写 Phase 3 代码时,要在真实浏览器(不是无头测试)里把两种方式都验证一遍,再定下来最终用哪个。

---

## 已知的良性噪音（不是我改动引入的）

- `npm run build` 生成静态页面时会打印一段 `ReferenceError: Worker is not defined` 的堆栈（在 SSR 阶段，`maplibregl.setRTLTextPlugin` 内部某处试图用 `Worker`，Node 环境没有这个全局对象）。这是精简之前、原始仓库就有的行为，不影响最终产物（页面依然正常生成、`npm run preview` 能跑），先记录在案，不在本次改造范围内修。

---

## 7. Phase 4 —— 剖面图 / Why 解释器（`ProfilePanel`）

对照 PRD/工程设计 v0.2 核实进度后，`components/SidePanel.jsx` 里 `activeTab === "features"` 分支一直是"Analysis coming soon"占位文案（第 1B/4 节留下的 TODO），这是 M2 MVP 闭环里最后一块缺的 P0 功能——用户选完发射点、点地图上任意一点，要能看到"这个点看不看得见 + 沿视线被哪些楼挡住"的解释，而不只是网格上的一个红绿点。

**算法层新增**：`lib/viewshed/sightline.js` 的 `computeMinAlt` 只返回"最大 req"这一个数字，不保留是哪几栋楼、挡在哪个距离——画剖面图需要明细。新增 `lib/viewshed/computeProfile.js` 的 `computeSightlineProfile()`，复用（不改）`intersectSegmentBuilding`，对每栋建筑单独调用、收集 `{distance, height, req}` 按距离排序返回，手法上跟 `computeViewshed.js` 一样"以 launch 为原点投影到局部米制平面"。单测 `__tests__/computeProfile.test.js`，沿用既有的手算验证风格（1-2 栋已知位置/高度的楼，手推期望值）。

**架构上延续了第 6 节"不改 `MapView.jsx` 核心状态机"的原则，但做了一处小突破**：`LaunchPointControl.jsx`（生产者，在 `MapView.jsx` 外面）需要把"用户点了哪个观察点、算出的剖面结果"传给挂在 `SidePanel.jsx`（`MapView.jsx` 内部子树）里的新 `ProfilePanel`（消费者）——两者不是父子关系，没法直接传 props，又不想为这一件事把 `MapView.jsx` 改造成受控组件。做法是新增一个跟 `lib/MapContext.js` 同款写法的 `lib/LaunchContext.js`（`createContext(null)` + `useLaunchAnalysis()`），配一个只放 state、不放业务逻辑的极薄 `components/launch/LaunchProvider.jsx`，在 `app/page.jsx` 里包一层。`ProfilePanel` 完全不需要经过 `MapView.jsx` 的 props 就能读到最新分析结果。

**唯一动了 `MapView.jsx` 的地方**：选观察点后如果不自动展开侧边栏切到 Features 标签页，用户点完什么反应都看不到，容易被当成没做出来。跟用户确认过，这个"自动展开"值得为它加一个新的、独立的 `useEffect`（只监听 `LaunchContext` 里 `analysis?.observer` 的变化，调用 `MapView.jsx` 自己已有的 `setActiveTab`/`setDrawerOpen`），不碰第 226 行那个既有的点击处理器/状态机代码本身——这是本次唯一一处动到 `MapView.jsx` 的地方，而且是纯新增、不改现有逻辑。

**选观察点的交互**：`LaunchPointControl.jsx` 里新增第三个独立的 `map.on("click", ...)` 监听器（跟"放置发射点"的监听器平行、各管各的，靠 `placingRef` 互斥）。故意**不要求点在某个已渲染的网格圆点上**——直接用点击的精确经纬度重新算一次剖面，比"必须点中一个 5px 的圆点"体验更好、实现也更简单（省了 `queryRenderedFeatures` 查网格图层这一步）；用 `makeLocalProjector` 把点击位置换算成到发射点的距离，超出 `ANALYSIS_RADIUS`（300m，跟网格计算共用同一个常量）就忽略，保证算出来的剖面背后总有查询到的建筑数据撑着。放置/移动发射点时顺带清掉旧的观察点选择（否则会残留一个指向旧发射点位置的过期剖面）。

**`ProfilePanel.jsx`（`components/analysis/`，工程设计 v0.2 早就规划好的目录落点）** 用调过色的 SVG 手画剖面示意图（仓库里没有图表库依赖，不新增）：横轴距离、纵轴高度，视线画成蓝色直线，**故意在建筑柱子之后画视线**——这样挡住视线的那栋楼会在视觉上把线"切断"，比线永远画在最上层直观。颜色上刻意复用 `LaunchPointControl.jsx` 里网格圆点已经在用的同一套红/黄/绿（`#d32f2f`/`#fbc02d`/`#2e7d32`），不是套 dataviz skill 默认调色板里不同色号的状态色——同一个产品里"红=挡住"这件事只应该有一套视觉语言。产生 `minAlt` 的那栋楼（真正的遮挡者）高亮红色 + 直接标注高度/距离，其余相交但非决定性的楼用中性灰，每根柱子挂一个原生 `<title>` 当轻量 hover，不为此引入新依赖。三种状态（未设发射点 / 已设发射点未选点 / 已出结果）配轻量 RTL 测试 `__tests__/ProfilePanel.test.js`，断言文案而不是 SVG 具体坐标。

**验证**：`npm test`（15 suite / 609 test 全过，含新增两个测试文件）、`npm run build` 通过（`Worker is not defined` 仍是上面记录过的良性噪音，跟本次改动无关）。真实交互没能在这次会话里用 Playwright 端到端跑通——这台机器上 headless Chromium 子进程连不上外网（`curl` 直接请求 STAC 目录是通的，但 Playwright 启动的浏览器进程 fetch 报 `ERR_CONNECTION_RESET`），看起来是这台机器的沙箱网络策略只放行了部分进程，不是代码问题；交给用户在真实浏览器里实测（旧金山金融区，设发射点、点一个被楼挡住的位置确认剖面图和结论文字弹出，再点一个视野开阔的位置对比）。

---

## 8. 可视化改版 —— 红绿点换成放射状扇形 + 修正 f(k) 公式

用户带来了一份新的数学建模文档《烟花可视性数学模型.md》，同时提了个很直接的意见：不喜欢现在这种"红绿散点"的呈现方式，问能不能做成"放射性的"。这份文档比之前的 PRD/工程设计详细得多——把可见度重新形式化成一个质量泛函 Q(o)，还给了一个当前代码里**没有**用到的关键公式：圆盘被地平线切割后的可见面积精确解 f(k)。

**先写了一份报告，没直接动手**：把文档里的每个概念（掠射高度 a、f(k)、距离偏好、天气衰减 W、视角门 G、区域测度 μ）跟现有代码一一对照，标出哪些已经实现（a ↔ `computeMinAlt`/`req`，完全一致）、哪些能直接换掉（只有 f(k)——`fractionVisible` 一直是线性近似，不是文档给的几何精确解）、哪些需要新的外部输入或产品决策所以不建议现在做（天气需要接气象 API；视角门/主观权重文档自己都说是"留给真实用户反馈校准的自由参数"，跟 `scoring.js` 里 `angleScore`/`distScore`/`openness`/`score` 四个"只定签名不实现"的既有做法是一个判断）。"放射性"给了三个方向（A：图层换成 MapLibre 原生 `heatmap`，仓库里 `all-density-circle.json` 已经这么用过，照抄零风险；B：采样本身从方格坐标换成极坐标，画成扇形色块，真正从发射点放射出去；C：B 再叠一层 heatmap）。用户选了 **B**，并确认 f(k) 精确公式要跟着一起换。

**`lib/viewshed/scoring.js`**：`fractionVisible` 从 `1 - (minAlt-lower)/(upper-lower)` 的线性插值换成 `k = (minAlt-targetHeight)/shellRadius; f(k) = [arccos(k) - k·√(1-k²)]/π`。两者在 k=0（掠射高度正好卡在烟花球中心）时都等于 0.5——这是圆的对称性决定的，不代表两个公式吻合——但偏离中心后差别很明显，k=0.5 时线性给 0.25、几何精确值约 0.196。`computeSightlineProfile`（Phase 4 剖面图用的那个）内部调的也是这同一个 `fractionVisible`，不用改代码就跟着变精确了。

**`lib/viewshed/computeViewshed.js`**：采样循环从 Cartesian 方格（`for y... for x...` 裁圆）换成极坐标（`for ringIndex... for sectorIndex...`，`radialSpacing` 控制环间距、`angularSpacing` 控制角度间距），每个 (ring, sector) 采样格输出一个**扇形 Polygon**（四个角反投影成经纬度）而不是一个 Point——签名也跟着换了，`gridSpacing` 参数没了，换成 `radialSpacing`/`angularSpacing` 两个。这是一处**破坏性**的函数签名改动，好在只有 `LaunchPointControl.jsx` 一个调用方，直接改掉就行，不用留兼容层。

**`components/launch/LaunchPointControl.jsx`**：地图图层从 `circle`（画点）换成 `fill`（画扇形色块），`fill-color` 复用原来那套红/黄/绿插值，`fill-outline-color` 给个很淡的描边让相邻扇形之间有条细线，不然大片同色区域会糊成一块看不出网格感。图层 id 从 `vantage-viewshed-points` 改名 `vantage-viewshed-sectors`（这个字符串只在这一个文件里出现，改名不影响别处）。采样密度定为 `RADIAL_SPACING=20m`、`ANGULAR_SPACING=6°`（每圈 60 个扇区），300m 半径算下来 15 圈 × 60 扇区 = 900 格，跟之前方格网格"约 2150 个点"同一个数量级，视觉密度不会突然变粗糙。

**没做的**（报告里就说清楚了，不是这次漏掉）：距离甜蜜区高亮环、方向开阔度 Ω(o)、天气衰减——虽然极坐标这个坐标系天然适合承接这些（甜蜜区就是某个 r 上加一圈描边，方向开阔度就是按角度扇区统计），但都需要新的输入或产品判断，留到用户明确要做的时候再加。

**测试**：`__tests__/scoring.test.js` 两个"linear"相关的用例改成手推几何公式期望值（其中一版第一次手算错了小数点后第四位，被 Jest 抓出来纠正了）；`__tests__/computeViewshed.test.js` 整个重写——原来靠精确坐标匹配一个网格点（`findCell`）的写法在极坐标下不适用，换成"选一组能让某个扇区中心正好落在建筑连线上的 ring/sector 参数（比如 `angularSpacing=120°` 时 sector 1 的中点正好在 180°），断言 3 个扇区里精确有 1 个被挡、2 个畅通"；`__tests__/computeProfile.test.js` 的两处 frac 期望值也从线性公式换成同款手推的 `arccos` 表达式。`npm test`：15 suite / 609 test 全过。`npm run lint`、`npm run build` 都过（`Worker is not defined` 仍是记录过的良性噪音）。真实交互还是受限于这台机器 headless 浏览器连不上外网，没能跑 Playwright 截图，交给用户在真实浏览器里看放射状扇形是否符合预期。

---

## 9. 口径驱动发射参数 + 复合可见度评分（P0 两项）

用户又带来一份更完整的数学建模文档《烟花可视性数学模型.md》，比第 8 节引入 f(k) 的那份还要系统——用两个探索 agent 把文档跟当前代码逐条核对后确认：f(k)（§3.2）已经在第 8 节接上了；口径决定弹道参数（§1.4）、视角大小门 G(θ)（§4.1）、仰角舒适区 E(φ)（§4.2）、天气衰减 W（§5）、多点分布 μ(b)（§6）全部没做。跟用户对齐优先级后，天气衰减和多点分布记进新建的 `todo.md`（P1，暂不做），这次动手做前两个 P0：口径驱动参数、G(θ)/E(φ) 复合评分。

**`lib/viewshed/caliber.js`（新增）**：`deriveShellParams(caliberInches)` 就是文档给的两条公式，`targetHeight = 30×c`、`shellRadius = 6.9×c`（c 单位英寸）。不做校验——只接受标准口径是 UI 层的事，这个函数本身跟 `fractionVisible` 一样，谁传什么就算什么。

**`components/launch/LaunchPointControl.jsx`**：原来"发射高度"和"烟花半径"两个互相独立的滑杆，换成一个口径滑杆（`step={null}` + `marks` 卡在 3/4/6/8/10/12 英寸六个标准值上，不能连续拖）,高度和半径完全由口径导出，**不提供手动覆盖**——这是文档自己的结论（"让用户选活动规模，R 与 z_b 自动带出"），也是这个功能存在的意义本身,提供覆盖等于把"两个滑杆物理不自洽"这个问题原样搬回来。

**`lib/viewshed/scoring.js`**：新增 `elevationAngleDeg`、`apparentAngularDiameterDeg` 两个纯几何函数，和 `angularSizeGate`（视角大小门 G）、`elevationScore`（仰角舒适度 E）两个"数学文档只给了定性描述、没给显式公式"的函数——跟 `lib/geo/normalizeBuilding.js` 的 `HEIGHT_SOURCE_CONFIDENCE` 一个性质，是这次会话自己给的第一版猜测,不是从文档derive出来的,代码注释里写清楚了：
- `angularSizeGate` 用 logistic 函数，中点定在文档给的 0.3°-0.5° 阈值区间内（0.4°），陡峭度自己选的（22/度），让这个区间大致对应 10%→90% 的过渡。
- `elevationScore` 用 smoothstep 分段——文档原文自相矛盾（一会儿说"10°-35° 是甜蜜区"，一会儿说"低于 15°/高于 45° 要扣分"），这次的处理是把 15°/45° 当成硬边界，5° 起步爬升，让 10° 正好卡在半credit的位置，不是两头都占。

`score()` 把这些拼成 Q(o) 的简化版：`frac × weather(默认1，天气还没做) × angularSizeGate(θ) × elevationScore(φ)`——`openness` 这一项完全**没有**乘进去（不是乘个 0），因为两份文档都没给公式，乘个占位的 0 只会是测不到、永远死掉的代码。原来 `scoring.js` 里的 `angleScore`/`distScore` 两个桩函数直接删掉——它们是旧技术设计文档"加权求和"公式的产物，新文档的 Q(o) 结构里根本没有对应项（仰角已经把距离偏好包含进去了），继续留着就是两份文档、两种打分逻辑并存的死代码。

**`lib/viewshed/computeViewshed.js`/`computeProfile.js`**：`EYE_HEIGHT` 常量原来两个文件各写一份 1.6，这次改成从 `scoring.js` 统一 import。每个网格格子/每次点击剖面，除了原来的 `frac` 之外多算一个 `score`。**地图上的色块渲染源从 `frac` 换成了 `score`**——这是一处会让人一眼看着奇怪但其实是设计意图的改动：发射点正下方那一圈，就算完全没有建筑遮挡（`frac=1`），因为抬头看的角度太陡（仰角超过 45°），`elevationScore=0`，`score` 也会是 0，色块显示成红色。真机截图验证过：金融区一个真实点，`frac=100%`（完全可见）但 `Overall viewing quality` 显示 `0% (Blocked)`，面板上有一行文字专门解释这个"看得见但角度太差"的情况,不是 bug。

**`components/analysis/ProfilePanel.jsx`**：原来的"Visible — N% of the shell"这行原样保留（这行文字被测试钉死了），下面新加一行"Overall viewing quality: N% (label)"显示复合分数，再加一行小字说明"这个数字包含了视角大小和仰角，不只是有没有被挡"。

**测试**：新增 `__tests__/caliber.test.js`（6 个标准口径 + 1 个非标准口径校验函数本身不做限制）；`scoring.test.js` 大改——删掉 `angleScore`/`distScore` 相关用例，新增 `elevationAngleDeg`/`apparentAngularDiameterDeg`/`angularSizeGate`/`elevationScore`/`score` 的手推期望值（拿计算器/node 独立推一遍公式，不是导入内部常量再跑一遍同样的代码）；`computeViewshed.test.js` 新增一个用例——用 300m 半径、100m 间距、360° 一个扇区的粗网格,专门验证"同样 `frac=1`,离发射点 50m 的环因为仰角太陡 `score` 精确等于 0,150m/250m 的环因为落在仰角甜蜜区 `score` 精确等于 1"；`computeProfile.test.js`/`ProfilePanel.test.js` 补上 `theta`/`phi`/`score` 字段的断言。`npm test`：16 suite / 634 test 全过，`npm run build` 通过。这次机器上 Playwright 的网络问题不知为何消失了，端到端跑通了真实浏览器截图：口径滑杆卡点正确、发射点周围红圈符合预期、点击后剖面面板的"Overall viewing quality"行渲染正确。

---

## 10. 修正配色 —— "核心区"和"看不见"不能共用红色

用户看完上一节的截图后指出一个真实的设计问题：地图按 `score` 上色之后，发射点正下方那圈"角度太陡"的区域和真正被建筑挡住的区域，颜色都是红——两件完全不同的事（一个是"物理上就是看不见"，一个是"技术上能看见但站的位置/角度不合适"）被压缩成了同一个视觉信号，这不行。

**根因**：`score = frac × weather × angularSizeGate(θ) × elevationScore(φ)` 是个连续乘积，`frac=0`（真被挡）和 `elevationScore=0`（角度不好但没被挡）都会让 `score` 算出 0，用同一根红-黄-绿渐变上色，自然分不清。

**修法**：不再用连续的 `score` 上色，改成离散的四类——`lib/viewshed/scoring.js` 新增两个函数：
- `comfortFactor(thetaDeg, phiDeg)`：把 `score()` 里"跟遮挡无关"的那部分（视角大小门 × 仰角舒适度）单独拆出来，`score()` 本身不变。
- `visibilityCategory(frac, comfort)`：按优先级分四类——`frac` 很低（<0.15）→ **blocked**（真被挡，跟角度无关，判断顺序上这条最先生效）；不然如果 `comfort` 很低（<0.5）→ **poor-angle**（没被挡但角度/距离不合适，这是这次要新增的第三种颜色）；不然 `frac` 还没到 0.85 → **partial**（角度没问题但只挡了一部分）；否则 → **good**。三个阈值都是这次自己给的第一版猜测，跟 `angularSizeGate`/`elevationScore` 一个性质。

**`computeViewshed.js`/`computeProfile.js`**：每个网格格子/剖面结果里多一个 `category` 字段（`frac`/`score` 两个数值字段原样保留，给想要原始数据的人）。

**`components/launch/LaunchPointControl.jsx`**：`fill-color` 从按 `score` 连续插值换成按 `category` 精确匹配（`match` 表达式）——红=blocked、**紫=poor-angle**（新增，特意选了一个不在红黄绿光谱上的颜色，一眼就能看出"这是另一种问题"）、黄=partial、绿=good。面板文案也换成对应的图例说明。

**`components/analysis/ProfilePanel.jsx`**：原来"Overall viewing quality"那一行的颜色/文字是拿 `verdictColor(profile.score)`/`verdictLabel(profile.score)` 复用第一版验证结果那一行的三档阈值函数算的——这次单独建了 `CATEGORY_COLOR`/`CATEGORY_LABEL` 两张表，跟地图配色完全对应（"Bad angle"对应紫色），不再共用那两个只认三档红黄绿的旧函数。

**验证**：真机截图，旧金山金融区实测——发射点周围出现一圈干净的**紫色**环，和外围真正被高楼挡住的**红色**区域清楚分开；`querySourceFeatures` 统计出四个分类都有真实数据命中（`poor-angle` 415、`blocked` 1273、`good` 94、`partial` 8）。`npm test`：16 suite / 642 test 全过（新增 8 个用例：`comfortFactor`/`visibilityCategory` 的单测，加上已有测试文件里补的 `category` 断言），`npm run build` 通过。

---

## 9. 城市搜索落地页 —— `/` 不再直接进地球

产品判断：VANTAGE 是街区尺度的分析工具，一打开对着全球地球既慢又不知道该干什么。首页改成搜城市，选中后再进原来的地图页，并且已经定位到那座城。

**路由**：原来的 `app/page.jsx` 整页搬到 `app/map/page.jsx`（地图、发射点、剖面图一条都没改）。新的 `/` 只渲染 `CitySearch`，不加载 MapLibre。分享链接（`/map#zoom/lat/lng`、`?layers=`、`?feature=`）仍然指向地图页，hash 读取逻辑原样跟着搬家。顶栏 logo 改成链回 `/`，方便换一座城。

**定位**：复用 header 搜索同一套 geocoder（`geocoder.bradr.dev`）。`lib/geocoder.js` 把结果转成 `/map#zoom/lat/lng`——建筑挤出图层 `minzoom` 是 14，所以城市视野夹在 14–14.5，避免落到看不到楼的尺度。提交搜索（按钮或回车）走第一条结果；下拉可以点具体条目；下面五个建议芯片（旧金山等）不经过 geocoder，直接跳。

**没做的**：没有把 header 里那套 locality/country/GERS 搜索搬到落地页——落地页只搜城。地图页 header 的 SearchBox 原样保留，进城之后还能精细定位。

---

## 10. 把辐射圈从 300m 扩到 1.5km

用户反馈辐射圈太小。两层原因叠在一起：搜城落地在 z14.5 时 300m 在屏幕上只有约 50px；物理上 12 英寸弹的 15° 仰角甜蜜区要到约 1.3km 才结束，300m 连 3 英寸的"太远"紫环都画不全。

`LaunchPointControl.jsx` 的 `ANALYSIS_RADIUS` 300 → **1500**，剖面点击的距离钳制跟它共用同一个常量所以一起变大。环间距 20m → **40m**，格子数 15×60=900 变成 37×60≈2220，跟最早笛卡尔网格"约 2150 点"同一量级，不把主线程计算再翻三倍。算法函数签名没变，单测都是自己传入 `analysisRadius` 的，不用改。

---

## 11. P1-3 —— 发射点在楼顶时起算高度加上楼高

用户带着 `todo.md`（新建于上面几节期间）来对齐优先级，先让写了一份分析报告（存在 `ai_reports/2026-08-30-todo-analysis.md`），确认 P1-3 是清单里最小、最干净、纯粹是 bug 不是新功能的一项，随后单独拎出来做。

**问题**：`targetHeight`（烟花球高度）一直是从 z=0 绝对地面往上算 `caliber.js` 导出的相对高度。如果用户把发射点点在一栋楼的楼顶（有组织的秀常见做法），真实燃放高度应该是"这栋楼的高度 + 口径导出的相对高度"，现在的算法把整栋楼的高度白白漏掉了。

**新增 `lib/geo/rooftopBase.js`**：`findRooftopBase(point, buildings)`，标准射线法（even-odd rule）点在多边形内判断，只查外环（跟 `lib/viewshed/sightline.js` 的遮挡判断一样不管天井洞）。`point`/`buildings.footprint` 都还是原始经纬度（没投影成局部米制平面）——这一步只是拓扑包含判断，不是量距离，直接在经纬度平面上做跟投影到米制平面结果一样，没必要多一次投影。多栋楼的轮廓重叠（比如裙楼上面立一座塔楼，点刚好落在两者都覆盖的范围）时取**最高**的那栋——你实际站的是塔楼楼顶，不是裙楼楼顶。`normalizeBuilding()` 的 `height` 字段本来就是从地面算起的绝对楼高（不是要再加 `base`），直接拿来用。

**接入 `LaunchPointControl.jsx`**：`deriveShellParams(caliber)` 解构出来的原始值改名 `caliberHeight`（保持这个函数本身纯粹"口径→相对高度"，不掺楼顶逻辑），新增 `rooftopBase` state，`targetHeight = caliberHeight + rooftopBase`。计算网格的那个 effect 里，本来就在查 `buildings`（算遮挡用），顺手用同一批数据算一次 `findRooftopBase`——不需要新的查询。**这里有一个容易踩的坑**：`rooftopBase` 是 state，effect 里 `setRooftopBase(rooftop)` 之后要等下一次渲染才生效，如果这次 `computeViewshed` 还接着读外层的 `targetHeight`（还是上一轮的值），算出来的网格会滞后一拍——所以网格计算这里没有读 state 派生的 `targetHeight`，而是本次查询算出的本地变量 `caliberHeight + rooftop` 直接传给 `computeViewshed`，`rooftopBase` state 只用于展示（面板文字）。**顺带修了一个因为这次改动会暴露出来的依赖数组问题**：网格 effect 和剖面 effect 原来依赖数组里写的是 `caliber`（当时 `targetHeight` 是 `caliber` 的纯函数，用 `caliber` 当代理没问题），现在 `targetHeight` 还依赖 `rooftopBase`，继续用 `caliber` 当代理会让 rooftop 变化时两个 effect 都不重新跑——改成直接依赖 `targetHeight`/`shellRadius` 本身。

**UI**：发射点面板那行文字，`rooftopBase > 0` 时多显示一段 `(incl. Nm rooftop)`，让用户能看到楼顶高度确实被算进去了。

**测试**：新增 `__tests__/rooftopBase.test.js`，5 个用例（点不在任何楼里→0、没有楼→0、点在楼里→返回楼高、两栋楼轮廓重叠取更高的那栋且跟输入顺序无关、点刚好在轮廓外一点点→0）。`npm test`：19 suite / 655 test 全过。`npm run lint`：只有一条已知能接受的 `react-hooks/set-state-in-effect` warning（跟仓库里已经存在的同类写法一个性质，不是新的问题类别）。`npm run build` 通过（`Worker is not defined`/`ECONNRESET` 仍是记录过的良性噪音）。

---

## 12. 调试用的实时性能 HUD

用户反馈放置发射点很卡，想知道原因，让在页面左上角加一个实时性能数据。这不是产品功能，是给 `todo.md`"地图页卡顿"那一节诊断用的临时工具。

**新增 `lib/perf.js`**：`reportViewshedPerf(detail)`/`onViewshedPerf(callback)` 一对函数，底层就是一个 `window` `CustomEvent`——选这个而不是走已有的 `LaunchContext`，是因为这纯粹是调试数据，跟 `ProfilePanel` 消费的分析结果不是一回事，不该混进同一条数据通道；用事件而不是新开一个 Context，是因为生产者（`LaunchPointControl.jsx`）和消费者（新的 `PerfOverlay.jsx`）不需要共享状态，只是单向广播一次性数据。

**新增 `components/launch/PerfOverlay.jsx`**：左上角悬浮面板，两块数据——
- **FPS**：自己起一个 `requestAnimationFrame` 循环，每 ~500ms 采样一次，跟 `LaunchPointControl` 上报的数字完全独立。这是故意的：FPS 掉了但下面 viewshed 耗时很小，说明卡顿另有原因（`todo.md` 里点名的 `mousemove` 全图层 hit-test、双 MapLibre 实例同步——这两个都在 `MapView.jsx` 里，这次没有为了测它们去碰那个文件），FPS 和 viewshed 耗时一起降，才指向 viewshed 计算本身。
- **viewshed 耗时**：`LaunchPointControl.jsx` 的网格计算 effect 里用 `performance.now()` 包了两段——`querySourceFeatures`+`buildingsFromMapFeatures`（"query"）和 `findRooftopBase`+`computeViewshed`（"compute"，含上一节新加的楼顶判断），连同建筑数/格子数一起上报。

**只在开发环境挂载**：`app/map/page.jsx` 里 `{process.env.NODE_ENV !== "production" && <PerfOverlay />}`。验证过 `npm run build` 产物里 `PerfOverlay.jsx` 自己的 JSX（比如"place a launch point to see viewshed timing"这行文案）确实没进最终 bundle，`next build` 会把 `NODE_ENV` 内联成字面量、走标准 tree-shaking 拿掉整个死分支——`lib/perf.js` 的 `reportViewshedPerf` 调用本身没做同样的开发环境判断，仍然留在生产包里，但这是有意的：不带监听者广播一个 `CustomEvent` 开销可以忽略，不值得为了省这几行代码再套一层判断。

**没做的**：这次只测了 VANTAGE 自己这条链路（query+compute），没有去给 `MapView.jsx` 的 `mousemove` hit-test 或双图同步加时间戳——那需要动 `MapView.jsx` 内部逻辑，跟 `ai_reports/2026-08-30-todo-analysis.md` 里说的"这是目前为止最大的一次例外，应该单独做"是同一个判断，不顺手夹带。

**验证**：`npm test`（19 suite / 655 test，没有新增测试文件——这是调试工具不是算法，FPS/耗时数字本身没有"正确答案"可断言）、`npm run lint`（没有新增 warning）、`npm run build` 通过，并且专门确认了 `PerfOverlay` 没有进生产 bundle。

---

## 13. 卡顿真修——建筑裁剪 + 接上 Worker

用户看完 PerfOverlay 数字之后确认：卡是因为 `computeViewshed` 在主线程同步跑，把浏览器整个卡死，而不只是算得慢。核对之后拍板：两件事一起做——建筑范围裁剪（减少总运算量）+ 挪进 Worker（运算量不变，但不再挡主线程）。这是 `todo.md`"地图页卡顿"一节里 `ai_reports/2026-08-30-todo-analysis.md` 评价"性价比最高"的那一项。

**新增 `lib/geo/buildingsNearPoint.js`**：`filterBuildingsNearPoint(buildings, point, radiusMeters)`。原理很直接——`computeViewshed` 测的每一条视线，一端是分析半径内的观察点、另一端是发射点本身，所以半径以外的建筑物理上不可能出现在任何一条视线上，可以在喂给遮挡算法之前就整个丢掉。按顶点距离过滤（不是精确的"点到多边形边"距离），因为建筑轮廓（几米到几十米）相对分析半径（几百米）小到可以忽略，加了 50m 安全边距兜住这点误差。之前 `querySourceFeatures` 拿到的是当前视口/已加载瓦片里的**全部**建筑（可能几百到几千栋），现在裁到半径内，运算量是真的变小，不是换个地方跑。同一个过滤函数在网格计算和剖面点击两处都用了。

**接上 `lib/viewshed/worker.js`**：这个文件从 Phase 6（`notes.md` 更早那一节）写好之后就没人 import 过。这次真正用起来了：`LaunchPointControl.jsx` 里 `new Worker(new URL("../../lib/viewshed/worker.js", import.meta.url))`，用的是 webpack 5 内置的 worker 打包支持（不是把 `lib/viewshed/worker.js` 当静态文件塞进 `public/`——那是 MapLibre 自己预编译好的 worker 才用的模式，见 `scripts/copy-maplibre-assets.mjs`；`worker.js` 用了 `@/lib/viewshed/computeViewshed` 这种别名 import，得走 webpack 编译，两种模式不能混用）。Worker 实例在组件挂载时建一次、卸载时 `terminate()`，不是每次请求建一个。

**并发正确性**：`computeViewshed` 本身没变快，如果用户快速拖口径滑杆，会连续 `postMessage` 好几次，Worker 是单线程顺序处理，响应可能乱序"追上"——如果直接用一个共享的 `worker.onmessage` 覆盖式赋值，旧请求的迟到响应可能被新请求的 handler 误当成自己的结果处理，把地图上的新数据换回旧的。这里用 `requestIdRef`（每次请求自增）+ 给每次 `postMessage` 各自挂一个 `{once:true}` 的独立监听器，每个监听器的闭包记着自己发出时的 `requestId`，响应回来时跟当时最新的 `requestIdRef.current` 比对，对不上就丢弃——不去尝试真正取消 Worker 里已经在算的那次请求（Worker 原生不支持取消一条正在处理的消息），只是保证界面不会被过期结果覆盖，Worker 会白算几次但界面永远显示最新请求的结果。

**验证结果不是靠猜的**：`next build` 产物里专门 grep 确认了 `lib/viewshed/worker.js` 被打包成了一个独立、极小（2.3KB 未压缩）的 chunk（`439.d486cdbaba05318f.js`），内容只有 `fractionVisible`/`elevationAngleDeg`/`apparentAngularDiameterDeg`/`angularSizeGate`/`elevationScore` 加一个 `self.onmessage=...`——不含任何 React/MUI 代码；主 chunk 里 `new Worker(...)` 那行编译成 `new Worker(r.tu(new URL(r.p+r.u(439),r.b)))`，`r.p` 是 webpack 的 publicPath（带 `basePath`），确认部署到子路径也不会指错。

**测试**：新增 `__tests__/buildingsNearPoint.test.js`，6 个用例（半径内保留、半径+边距外丢弃、卡在边距带内保留、刚过边距丢弃、轮廓跨边界只要有一个顶点在范围内就保留、混合列表正确过滤）。`npm test`：20 suite / 661 test 全过。`npm run lint`：跟之前一样只有一条已知能接受的 `set-state-in-effect` warning，没有新增问题。`npm run build` 通过。

**没做的**：Worker 里现在还是每次收到消息都重新跑一遍完整 `computeViewshed`——没有做"如果建筑没变，复用上一次结果"之类的缓存，也没有真正取消掉过期请求在 Worker 里的计算（只是丢弃它的结果）。`todo.md`"地图页卡顿"一节剩下两条（拦住误选、去掉 mousemove hit-test）都要动 `MapView.jsx` 核心逻辑，这次没有顺手做。

（辐射半径后来又从 500m 改回 1500m——用户想看接上 Worker + 建筑裁剪之后 1500m 的真实体感，效果可以接受，就没再往下调。只改了 `LaunchPointControl.jsx` 里的常量和注释，没有单独立一节。）

---

## 14. M2 收尾——地图误选高亮（配置那一半）+ 高度置信度标注 + 活动书签

问完"下一个 milestone 是什么"，用户从候选里选了三项：修地图误选高亮、补高度置信度标注、补活动书签——数学模型 P1（天气/多点分布）这次不做。这次动手前先写了计划（`ai_reports` 之外，这次直接用会话里的 plan 走的，没有单独存报告文件），跟用户对齐了范围。

### 地图误选高亮——只做了配置那一半

`todo.md` 把"点哪都可能整片飘红"记成一类问题，但拆开看其实是两个独立成因，严重程度和修复代价都不一样：

1. `base` 主题的大面积填充图层（land/water/land-cover/bathymetry）本身就允许被点选——`lib/LayerManager.js` 的 `getInteractiveLayerIds()` 只排除 `metadata["overture:selectable"]===false` 的图层，这些图层的 JSON spec 之前写的是 `true`。点中一块地/一片海会触发 `feature-state:selected`，整片刷半透明红——这是"整片飘红"**唯一**的成因，跟 VANTAGE 有没有在放发射点完全无关，原生 explore 模式点一下海也会这样。
2. VANTAGE 自己的点击监听器和 `MapView.jsx` 既有的要素选取逻辑并行跑，点在建筑上会让侧栏意外弹出——这个是 Phase 3/4 就记录过的"刻意接受的小瑕疵"，这次没动。

只做了第 1 条：把 `land`/`water`（ocean、lake-river、lake-river-intermittent）/`land-cover`（wetland/forest/grass/mangrove/moss/shrub/snow/barren/crop 共 9 个）这 13 个大面积填充图层的 `overture:selectable` 从 `true` 改成 `false`。**核对时发现 `bathymetry` 的 8 个深度带图层已经是 `false` 了**——不知道是谁、什么时候顺手改的，不在这次改动范围内，直接跳过。`land-use`（park/cemetery/college/medical/military/recreation）、`infrastructure`（pier/aerialway/airport）、水系的 `line`/`label`（不是大面积填充）全部没动——这些是用户可能真的想点开看的具体地块/线状要素，`todo.md` 原文点名的也只是"land/water/land_cover"。第 2 条要动 `MapView.jsx` 既有点击处理器本身，是目前为止唯一一处会突破"只加独立 effect、不碰核心逻辑"这个原则的地方，留着单独做。

**测试**：新增 `__tests__/selectableLayers.test.js`，直接用真实的 `defaultLayerSpecs`（`components/map/index.js` 里已经把 `id` 注入好了，格式就是运行时 `map.getStyle().layers` 的样子）+ 一个只实现了 `getStyle()` 的假 `map` 对象跑 `getInteractiveLayerIds()`，断言这 13＋8 个大面积图层不在可选中列表里，同时断言 `land-use`/`buildings` 这些还能正常选中——防止以后被误改回 `true`。

### 高度置信度标注

`lib/geo/normalizeBuilding.js` 早就算出 `confidence`（high/medium/low）,但 `lib/viewshed/computeProfile.js` 把 `buildings` 投影成 `localBuildings` 时只留了 `{height, footprint}`，这个字段在这一步就被悄悄丢了，`hits[]` 里从来没出现过，`ProfilePanel.jsx` 也没地方读——补上：`localBuildings` 映射和 `hits.push()` 都带上 `confidence`。

`ProfilePanel.jsx` 只在真的有遮挡建筑时（`hits.length>0`）显示一行说明，读的是产生 `minAlt` 那栋楼（即 `req` 最大的那个，跟 `SightlineChart` 判断 `isBlocker` 用的同一条逻辑）的置信度，配一张 `CONFIDENCE_LABEL` 三档文案表。文案故意不写成"我们不确定"这种纯粹的免责声明口气——high/medium/low 各自说清楚"这个数字是哪来的"（直接数据 / 楼层数或社区数据估算 / 没有直接数据的粗略估计），PRD 原话是"信任积累项，不是负分项"，文案要对得上这个定位。`SightlineChart` 里每根柱子的 `<title>` hover 也顺手带上了置信度。

### 活动书签（`BookmarkDial.jsx`）

原来的 4 个书签（Paris/NYC/London/Boston）是通用城市取景点，换成 4 个真实、常年举办的知名烟花活动的取景点（沿用原来"4 个书签、扇形展开"的 UI，不改布局逻辑）：Bastille Day（埃菲尔铁塔，发射点本身）、Macy's July 4th（东河沿岸，看曼哈顿天际线的角度）、London NYE（伦敦眼、泰晤士河畔）、Boston Pops July 4th（查尔斯河 Esplanade/Hatch Shell，原坐标本来就很接近，微调）。标签加了 🎆 前缀，跟这次会话里其它 emoji 图例（🔴🟣🟡🟢、🧍）统一视觉语言。这几个是"挑个好看角度"性质的取景框架，不是测绘级精确数据——跟原来那 4 个城市书签的性质完全一样。

**顺带修的一个位置冲突**：`BookmarkDial` 原来跟 `LaunchPointControl` 的悬浮面板锚在同一个位置（都是 `bottom:24, left:'50%'`），设了发射点之后 `LaunchPointControl` 面板（z-index 更高）会整个盖住书签的 Fab 按钮，根本点不到。这次挪到左下角（`bottom:24, left:24`），避开 `LaunchPointControl`（底部居中）和 `PerfOverlay`（右下角，仅开发环境）。扇形展开角度从原来围绕正上方的 155°→25° 收窄成 100°→25°（偏向右上），因为锚点从屏幕底部居中挪到左下角后，原来的角度范围会把最左边的书签推到屏幕外面去。

**验证**：`npm test`：21 suite / 664 test 全过（新增 `selectableLayers.test.js` 2 个用例，`computeProfile.test.js`/`ProfilePanel.test.js` 各加了置信度相关的用例）。`npm run lint`、`npm run build` 都过，`build` 顺带验证了这次改的 13 个图层 JSON 语法没写错（不然 `schemaValidation.test.js`/`styleValidation.test.js` 或 build 本身会先炸）。`BookmarkDial.jsx` 本身跟 `LaunchPointControl.jsx` 一样没有单独的组件测试（依赖真实 map 实例，这是既有的测试策略边界，不是这次漏做）。

---

## 15. 观察者站在楼上——P1-3 的镜像 bug

用户自己想到的问题，不是数学文档带来的：如果把观察点选在一栋高楼上（比如订了楼顶酒吧看烟花），算法是不是还是按地面算？核对下来确实是——`EYE_HEIGHT=1.6` 在 `computeViewshed.js`/`computeProfile.js` 里都是写死的绝对高度，完全不知道观察点是不是落在建筑轮廓里。这正是 P1-3（发射点站楼顶）的镜像版本，只是这次是视线的另一端，而且现实里更常踩到——很多人是特意上楼顶找视野的。

先写了报告（这次直接在会话里的 plan 走的），把问题拆成"单点剖面图"和"整片辐射网格"两种场景分开看：网格要不要自动假设"每栋楼的楼顶都能站人"是个更大的产品判断，这次没做；单点剖面图（用户主动点了这一个点问"我站这儿看得见吗"）适合让用户自己说清楚站在哪一层，这次只做这个。用户确认：范围就做单点，高度选择器给"地面/楼层/楼顶"三档就够，不需要直接输入米数。

**`lib/geo/rooftopBase.js` 加了 `findBuildingAt`**：跟已有的 `findRooftopBase`（P1-3 用，只返回高度数字）平级，多返回一个 `confidence`——因为这次不只要知道"这栋楼多高"，还要在置信度低的时候提醒用户"你选的第 8 层这个数字本身就不太准"。`findRooftopBase` 顺手改成基于 `findBuildingAt` 实现（`?.height ?? 0`），避免点在多边形内的判断逻辑两处重复，行为完全不变，原有 5 个测试不改也全过。

**`lib/geo/normalizeBuilding.js` 的 `METERS_PER_FLOOR`（3.2m/层）导出了**——供 `LaunchPointControl.jsx` 把"第几层"换算回米数用，不再各处各猜一个系数。

**`lib/viewshed/computeProfile.js`**：`computeSightlineProfile()` 加一个可选参数 `observerHeight`（默认还是 `EYE_HEIGHT`，不传行为完全不变），观察者的 z 坐标、`heightDiff`（进而 `theta`/`phi`/复合评分）、返回的 `eyeHeight` 字段全部从写死的 `EYE_HEIGHT` 换成这个参数——之前 `eyeHeight` 返回值其实一直是常量本身而不是"实际用的观察高度"，这次顺带修正。剖面图的 SVG 图表（`SightlineChart`）完全不用改代码就能正确画出"你"站在高处的样子，因为它本来就是拿 `profile.eyeHeight` 算纵轴位置的——只是加了一根"你站的这栋楼"的柱子（`eyeHeight` 明显高于地面时才画），不然人会看起来悬空。

**`lib/LaunchContext.js`/`LaunchProvider.jsx`**：新增 `viewerLevel`（`{mode: "ground"|"floor"|"rooftop", floor}`）+ `setViewerLevel`，跟 `analysis` 平级放在同一个 context 里——`LaunchPointControl.jsx`（生产者，算出发射点/观察点分析结果的地方）读它来决定喂给 `computeSightlineProfile` 的 `observerHeight`，`ProfilePanel.jsx`（消费者）读它来渲染选择器、写它来响应用户点选。选了新的观察点时会把 `viewerLevel` 重置回"地面"——上一个点选的"楼顶"不该原样带到下一个可能完全不在楼里的新点上。

**`LaunchPointControl.jsx` 的剖面计算 effect**：复用已经查好的 `buildings`，跑一次 `findBuildingAt(observer, buildings)` 判断观察点是否在楼里，算出 `maxFloors`（`Math.round(楼高/3.2)`），根据 `viewerLevel.mode` 算出实际 `observerHeight`（地面=1.6m 不变；楼层=`(第几层-1)×3.2+1.6`；楼顶=`楼高+1.6`），连同 `observerBuilding`（含高度/置信度/楼层数，给面板渲染用）一并放进 `setAnalysis`。

**`ProfilePanel.jsx`**：`analysis.observerBuilding` 存在时，在剖面结果之前显示一个 `ToggleButtonGroup`（地面/楼层/楼顶）+ 选了楼层时出现的 `Slider`，选完直接触发 `LaunchPointControl.jsx` 重新算。楼高置信度不是 high 时复用第 14 节的 `CONFIDENCE_LABEL` 文案，跟高度置信度标注那套视觉语言保持一致，不另起一套。

**测试**：`__tests__/rooftopBase.test.js` 新增 `findBuildingAt` 的 3 个用例（找不到返回 null、返回高度+置信度、多楼重叠时置信度跟着最高的那栋走）。`__tests__/computeProfile.test.js` 新增一个用例——同一栋 60m 高的楼、同一个观察点 XY，地面观察者算出完全被挡（`frac=0`），站在旁边 65m 高的楼顶算出完全看得见（`frac=1`），手推 `req` 验证两个数字都对得上几何公式。`__tests__/ProfilePanel.test.js` 新增 2 个用例（选择器正确渲染、选了楼层模式后滑杆正确出现）。`npm test`：21 suite / 670 test 全过。`npm run lint` 一开始多了一条新 warning（`viewerLevel` 的 fallback 对象字面量每次渲染都是新引用，会让 effect 依赖数组失效），用 `useMemo` 包一下就干净了。`npm run build` 通过。
