# vantage-core (WASM)

VANTAGE 的视域计算内核（Rust → WebAssembly），供浏览器 Web Worker 调用。

**当前阶段：Phase A（打通管道）**。只导出一个函数 `fraction_visible`
（`lib/viewshed/scoring.js` 的等价 Rust 版本）用来验证：Rust 工具链、
wasm-pack 打包、npm 本地包引用、Next.js webpack 集成、Worker 内动态 import、
JS ↔ WASM 双精度浮点通信。全链路通了才谈 Phase B / C 的性能收益。

后续阶段计划见根目录 `架构与数据依赖梳理.md` §Cloudflare Workers 迁移候选。

---

## 首次开发环境准备

需要 Rust 工具链。已装可跳过。

```sh
# rustup + Rust stable
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable
source "$HOME/.cargo/env"

# WASM 目标
rustup target add wasm32-unknown-unknown

# wasm-pack（用预编译二进制装法，避免 Xcode CLT 完整依赖）
curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh
```

macOS 上如果 `xcode-select -p` 指向被卸载/损坏的 Xcode，本地 cargo
build（build.rs 脚本要跑）会失败。绕过办法：设 `DEVELOPER_DIR` 到
CommandLineTools：

```sh
export DEVELOPER_DIR=/Library/Developer/CommandLineTools
```

---

## 构建

```sh
# 从仓库根：
npm run build:wasm

# 或直接：
cd wasm/vantage-core
DEVELOPER_DIR=/Library/Developer/CommandLineTools wasm-pack build --target bundler --release
```

产物：`wasm/vantage-core/pkg/`。已经在根 `package.json` 里挂
`"vantage-core": "file:./wasm/vantage-core/pkg"`，`npm install` 会把它
链到 `node_modules/vantage-core/`。

**为什么 `--target bundler` 不是 `--target web`**：bundler 模式产出用
`import * as wasm from "./vantage_core_bg.wasm"` 的 ESM，让 webpack 的
`asyncWebAssembly` 处理 WASM 加载；web 模式产出运行时 `fetch()` + `init()`
的自包装 glue，在 Worker 里能跑但绕开了 bundler 优化。

---

## 修改后重新加载

改 Rust 源码 → `npm run build:wasm` → dev server 热重载。**不要**
把 `pkg/` 之外的东西 import 到 JS 侧，那是构建产物。

单元测试（纯 Rust，不涉及 WASM）：

```sh
cd wasm/vantage-core
DEVELOPER_DIR=/Library/Developer/CommandLineTools cargo test
```

---

## Next.js webpack 配置说明

`next.config.mjs` 里的两条 experiments 是这个包能被加载的前提：

- `asyncWebAssembly: true` — 允许 `import` `.wasm` 作为异步模块
- `topLevelAwait: true` — wasm-bindgen bundler-target 的 glue 在
  模块顶层做 wasm instance init（webpack 表达成 top-level await）

`.wasm` 处理规则被限定成只匹配 `?url` query（历史遗留的 `?url` import
路径专用），不再覆盖标准 asyncWebAssembly 走的 `.wasm` 处理。

Worker 里必须用**动态** `import("vantage-core")`，不能顶层
`import { ... } from "vantage-core"`——顶层 import 会让 webpack 把
Worker 当 module worker 打包，触发 Next.js SSR 期评估 `MapView.jsx` 的
Worker 全局，报 `Worker is not defined`。见 `lib/viewshed/worker.js` 里
`phaseAWasmSelfCheck` 的注释。
