# TODO

原文件只记可视性数学模型跟代码的差距。下面按类别追加，不回头改写已有条目。

---

# 可视性数学模型 P1

来自 `烟花可视性数学模型.md` 与代码现状的差距分析。P0 两项(口径驱动的发射参数、G(θ)/E(φ) 复合评分)已经做完，见 `notes.md`。

## P1-1: 天气/大气衰减 W(o)

Koschmieder 公式(文档 §5):`W = exp(-3.912·s̄/V)`,s̄ 为代表性斜距,V 为气象能见度。

需要:
- 一个能见度输入——哪怕先是"晴/薄雾/雾霾"三档下拉,默认"晴",不需要一开始就接实时天气 API。
- 把算出来的 W 乘进 `lib/viewshed/scoring.js` 的 `score()` 函数——P0 已经把 `weather` 参数留好了(默认 1,不衰减),接上就行,不需要重新改结构。

## P1-2: 多点分布 μ(b) + 三种聚合算子

文档 §6:不再假设只有一个固定的烟花球点,而是燃放点位置的一个**分布**(至少先支持风力漂移造成的水平弥散;更进一步可以按口径/演出顺序加权——压轴的大烟花理应比开场的一堆小烟花更重要)。

需要三种聚合方式,给用户一个"我要保守估计还是乐观估计"的开关(文档原话:这是产品决策,不是数学问题):
- **mean/积分 C(o)**——"平均能看到百分之多少"
- **max Cmax(o)**——"至少能看到一发就算"(宽松)
- **min Cmin(o)**——"每一发都要看到"(严格)

这是整个清单里工作量最大的一项——会改到 `computeViewshed`/`computeProfile` 目前"只有一个固定 target 点"这个贯穿全链路的假设,不是改一个函数就行。

## P1-3: 发射点如果在建筑物上,起算高度应该是楼顶,不是地面 —— 已完成

现在选发射点时,不管点在哪,`targetHeight`(烟花球高度)都是从 z=0(绝对平地基准)往上算口径导出的 `30×caliber` 米。但如果用户点选的发射位置本身就在一栋建筑楼顶(很多有组织的烟花秀确实是在楼顶/驳船平台上放的),真实的燃放起始高度应该是"这栋楼的高度 + 口径导出的相对高度",不是从地面平地算起——现在的算法会把整栋楼的高度白白漏掉,系统性地低估了实际燃放高度。

**不是地形/DEM 那个问题**(见下面"其他已识别"里的地形项)——那个是"全场景地面高低不平"的通用问题,需要外部高程数据源;这个是"发射点这一个点本身可能站在楼顶"的特例,而且**不需要新数据源**——建筑数据本来就已经在查了(`buildingsFromMapFeatures`/`querySourceFeatures`),缺的只是"判断发射点是否落在某栋建筑的轮廓内,是的话把那栋楼的高度加到起算基准上"这一步逻辑,跟建筑自己的 `base`(`min_height`)字段是同一类概念。

实现见 `notes.md`。

## 其他已识别但优先级更低的项目(不展开,先记一笔)

- **地形/DEM 修正地面高程 —— 已完成**(2026-09-02,5 阶段,见 commit a1675db8 / 359e62a9 / 75e7941c / c86a87ca / phase-5)。选了"大路(真解)":AWS Terrain Tiles (Terrarium PNG,S3 免费无 auth)作为数据源,`lib/viewshed/ElevationGrid.js` 做 fetch+解码+双线性插值,`lib/viewshed/computeViewshed.js` 用径向扫描沿每方位角每 20m 采样地形作为遮挡物,同时把 O(N²) 的原实现降到方位角扫描量级(SF Fisherman's Wharf compute 从 ~4.2s 降到 ~2s)。方案文档 `地形高程集成_实施方案.md` 保留供以后回顾。
- **光污染/环境光对比度因子**——需要额外数据源(夜光遥感之类),现在只值得记一笔。
- **横向/方位角展开效应**——专业烟花秀常常沿一排发射架横向展开,观察者正对着看和侧着看视觉宽度差很多,这份数学文档完全没建模,需要先把数学讲清楚才能谈实现。
- **树木/植被遮挡**——现在的视线数学(`lib/viewshed/sightline.js`)只测建筑轮廓,树木一律不算。中央公园边缘、林荫大道这些地方分析会给出错误的 "clear" 结论。现在的 UI 已经在 LaunchPointControl 和 ProfilePanel 里各加了一行免责声明("Analysis considers buildings only ...")。真要修有两条路:**小路**是用 Overture 的 `land_cover` 多边形(`components/map/layers/explore/base/land-cover/*.json`,已经在数据里)做粗略提示——观察点落在 `forest`/`shrub` 多边形内或视线穿过时,ProfilePanel 加一行"你的视线可能被树遮挡"。没有高度但有真实几何信号。**大路**是接入全球树冠高度栅格(NASA GEDI + Sentinel-2 衍生的公开数据,比如 ETH 苏黎世 2023 年 10m 分辨率全球树冠高度图),把采样到的高度喂进 `computeMinAlt` 跟建筑一起算。全球规模、真实物理答案,但需要新的 raster tile 数据管道。跟"地形/DEM"是同一级别的数据工程量。

---

# 地图页卡顿与误选高亮

点地图会整片飘红、拖动/放发射点会卡，是同一类问题：**原站的"点谁高亮谁"调试交互，和 VANTAGE 的辐射分析叠在同一张图上，而且可见度还在主线程算。** 不是瓦片坏了，也不是辐射圈画错了。

根因有两支，体感上绑在一起：

1. **误选** — `MapView.jsx` 的 click 对所有 `"overture:selectable": true` 的图层做 `queryRenderedFeatures`，把第一个命中设成 `activeFeature`，`feature-state: selected` 整块刷半透明红。陆地 / 海洋 / 林地 / 公园在 Overture 里经常是整座半岛、整片海那么大；zoom≥10 时 `base` 图层不再被跳过。VANTAGE 放发射点、选观察点的监听器和这条逻辑并行，点哪里都会一起响。辐射扇形自己不可点，点击会穿过它打到下面的大地毯。
2. **卡顿** — `mousemove` 对上百个 interactive 图层做 hit-test（原站用来换 pointer 光标）；`computeViewshed` 在主线程跑，扇区还跟**整个视口**里 `querySourceFeatures` 拿到的建筑求交，不裁 1.5km；Explore/Inspect 双 MapLibre 实例每次 `move` 都同步。`lib/viewshed/worker.js` 写了但没接。

分步（先交互误伤，再计算）：

- **P0 拦住误选（一半已完成）**：这条其实是两个独立成因。**大面积 `land`/`water`/`land_cover` 退出可点高亮——已完成**（13 个填充图层的 `overture:selectable` 改成 `false`，`bathymetry` 8 个深度带发现已经是 `false` 了，不知道谁改的；实现见 `notes.md` 第 14 节），"整片飘红"这个症状已经解决。**"放发射点/选观察点时不要走 MapView 的要素选取"——还没做**，这条要动 `MapView.jsx` 既有点击处理器本身，跟其它 VANTAGE 改动"只加独立 effect、不碰核心逻辑"的原则不一样，值得单独做单独测，见 `ai_reports/2026-08-30-todo-analysis.md`。
- **P0 去掉全图层 mousemove hit-test**：拖地图会立刻顺很多。VANTAGE 不需要"悬停任何要素都变手型"。（还没做，同样要动 `MapView.jsx`。）
- **P1 裁建筑 + Worker —— 已完成**：建筑查询裁到分析半径内（`lib/geo/buildingsNearPoint.js`），`computeViewshed` 挪进 `lib/viewshed/worker.js` 跑（原来写好但没接的那个）。点发射点不再冻住主线程。实现见 `notes.md`。
- **P2 拆掉 Explore/Inspect 双图**：v0.2 本来就要删对比滑条，现在还在付双倍 GPU/瓦片。动 `MapView.jsx` 最深，单独做。（还没做。）

---

# 烟花可视化展示

## 动画和分析参数联动

放发射点时的烟花动画（`components/launch/LaunchPointControl.jsx` 的 `FIREWORK_CSS` + `buildFireworkHtml`）顶点位置硬编码在 launch pin 上方 140px（屏幕空间），跟口径完全无关——3" 和 12" 的烟花动画看起来一模一样。但口径推导的 `targetHeight`（3" 约 90m，12" 约 360m）本来就是这个动画应该反映的物理量。

需要：
- 顶点高度根据 `targetHeight` 线性放缩（比如从 100px 到 300px）
- 粒子数量、爆炸半径也随口径放缩（3" 小而紧凑、12" 大而开阔）
- 让动画从"跟参数无关的装饰"变成"看得见的物理反馈"

半小时工作量，改动集中在 `LaunchPointControl.jsx` 的 CSS + `buildFireworkHtml`。

## 观察点 3D 透视预览（"从这里看是什么样"）

用户选完观察点后，除了看侧栏里的数字和 sightline 图，希望能有个"从这里往发射点方向大概看一下是什么情况"的视觉预览——不用是照片写实级别的，能有个大致的场景感就行。可选实现方向：

- **小改**：允许下拉/拖动地图切成 3D 倾斜视角（maplibre 的 pitch 通过 ctrl+drag 已经能实现但不发现），需要 UI 引导或者一个"tilt"按钮，让用户能在地图上看到建筑挤出（`components/map/layers/explore/buildings/building/extrusion.json`）跟烟花高度的相对关系
- **大改**：在观察点位置渲染一个独立的 3D 迷你场景（比如面板里的一个 300×200 canvas）：前景是附近建筑的轮廓剪影、背景是天空、烟花在正确仰角处爆开——直接回答"从这里看到什么样"这个问题。既有的建筑高度数据（`normalizeBuilding`）加上 `computeSightlineProfile` 的仰角计算已经能算出所需的所有几何信息，不需要额外数据源

小改先做能立刻缓解痛点；大改工作量更大但是"能一眼看懂"的杀手锏，属于 `notes.md` 里那种可以单独开个 session 的项。
