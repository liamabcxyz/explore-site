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
  /**
   * @param {string} layerId - MapLibre layer id to toggle visibility on
   * @param {object} [opts]
   * @param {boolean} [opts.initialVisible=false] - seed state, used by
   *   the URL-restore path so opening a `?hs=1` link brings hillshade
   *   back visible. Layer visibility itself is applied lazily in `onAdd`
   *   once the layer exists.
   * @param {(visible: boolean) => void} [opts.onChange] - fires each time
   *   the user toggles the button (not on programmatic construction) so
   *   the caller can mirror the state into a URL param.
   */
  constructor(layerId, { initialVisible = false, onChange } = {}) {
    this._layerId = layerId;
    this._visible = Boolean(initialVisible);
    this._onChange = typeof onChange === "function" ? onChange : null;
  }

  onAdd(map) {
    this._map = map;
    this._container = document.createElement("div");
    this._container.className = "maplibregl-ctrl maplibregl-ctrl-group";

    this._button = document.createElement("button");
    this._button.type = "button";
    this._button.className = "maplibregl-ctrl-terrain";
    this._button.addEventListener("click", () => this._toggle());
    this._syncButtonChrome();

    this._container.appendChild(this._button);
    // If we were constructed with an initial-visible seed, apply it now
    // that the container is mounted — the layer itself may still be
    // asynchronously added by MapView, so guard the setLayoutProperty.
    if (this._visible && map.getLayer(this._layerId)) {
      map.setLayoutProperty(this._layerId, "visibility", "visible");
    }
    return this._container;
  }

  _syncButtonChrome() {
    const label = this._visible ? "Hide terrain relief" : "Show terrain relief";
    this._button.title = label;
    this._button.setAttribute("aria-label", label);
    this._button.classList.toggle("maplibregl-ctrl-terrain-active", this._visible);
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
    this._syncButtonChrome();
    this._onChange?.(this._visible);
  }
}
