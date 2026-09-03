/* @ts-self-types="./vantage_core.d.ts" */
import * as wasm from "./vantage_core_bg.wasm";
import { __wbg_set_wasm } from "./vantage_core_bg.js";

__wbg_set_wasm(wasm);
wasm.__wbindgen_start();
export {
    fraction_visible
} from "./vantage_core_bg.js";
