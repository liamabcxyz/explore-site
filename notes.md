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
