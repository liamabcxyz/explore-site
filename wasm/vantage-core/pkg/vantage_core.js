/* @ts-self-types="./vantage_core.d.ts" */
import * as wasm from "./vantage_core_bg.wasm";
import { __wbg_set_wasm } from "./vantage_core_bg.js";

__wbg_set_wasm(wasm);
wasm.__wbindgen_start();
export {
    angular_size_gate, apparent_altitude, apparent_altitude_k, apparent_angular_diameter_deg, comfort_factor, computeRooftopLayer, computeSightlineProfile, computeViewshed, curvature_drop, curvature_drop_k, elevationBilinear, elevation_angle_deg, elevation_score, eyeHeight, fraction_visible, intersectSegmentBuildingFlat, is_blocked, projectLatLngLat, projectLatLngLng, projectLocalX, projectLocalY, roundtripBuildings, roundtripTerrain, score, visibility_category
} from "./vantage_core_bg.js";
