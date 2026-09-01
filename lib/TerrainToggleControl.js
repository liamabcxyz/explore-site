/**
 * A maplibre IControl that toggles the terrain hillshade layer on/off.
 * Styled to match the built-in NavigationControl/GeolocateControl button
 * group (see CustomControls.css) so it stacks cleanly with them in the
 * top-right corner.
 *
 * Hillshade is registered hidden by default (see addHillshadeLayer in
 * LayerManager.js) — most users don't want the relief shading on by
 * default, so this control is opt-in rather than an opt-out.
 */
export class TerrainToggleControl {
  constructor(layerId) {
    this._layerId = layerId;
    this._visible = false;
  }

  onAdd(map) {
    this._map = map;
    this._container = document.createElement("div");
    this._container.className = "maplibregl-ctrl maplibregl-ctrl-group";

    this._button = document.createElement("button");
    this._button.type = "button";
    this._button.className = "maplibregl-ctrl-terrain";
    this._button.title = "Show terrain relief";
    this._button.setAttribute("aria-label", "Show terrain relief");
    this._button.addEventListener("click", () => this._toggle());

    this._container.appendChild(this._button);
    return this._container;
  }

  onRemove() {
    this._container.parentNode.removeChild(this._container);
    this._map = undefined;
  }

  _toggle() {
    const map = this._map;
    // The layer is added asynchronously once PMTiles/style setup finishes
    // (see MapView.jsx) — a click landing before that is a no-op rather
    // than a thrown error.
    if (!map || !map.getLayer(this._layerId)) return;

    this._visible = !this._visible;
    map.setLayoutProperty(this._layerId, "visibility", this._visible ? "visible" : "none");
    this._button.classList.toggle("maplibregl-ctrl-terrain-active", this._visible);
    const label = this._visible ? "Hide terrain relief" : "Show terrain relief";
    this._button.title = label;
    this._button.setAttribute("aria-label", label);
  }
}
