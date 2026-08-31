import { defaultLayerSpecs } from "@/components/map";
import { getInteractiveLayerIds } from "@/lib/LayerManager";

// getInteractiveLayerIds only ever calls map.getStyle() — defaultLayerSpecs
// (id already injected by components/map/index.js's resolveLayers()) is
// exactly what map.getStyle().layers looks like at runtime, so a real
// MapLibre instance isn't needed here.
const fakeMap = { getStyle: () => ({ layers: defaultLayerSpecs }) };

const ALL_ITEMS = [...new Set(
  defaultLayerSpecs.map((spec) => spec.metadata?.["overture:item"]).filter(Boolean)
)];

describe("large-area base fill layers are not click-selectable", () => {
  // Regression guard for the "click anywhere and the whole ocean/continent
  // flashes red" bug: land/water/land-cover/bathymetry are vast, amorphous
  // polygons, unlike a building or a park you might actually want to
  // inspect. See todo.md's "地图页卡顿与误选高亮" section.
  it("excludes land, water, land-cover, and bathymetry fills even when everything is visible", () => {
    const interactiveIds = getInteractiveLayerIds(fakeMap, ALL_ITEMS);

    const shouldBeExcluded = [
      "base-land-fill",
      "base-water-ocean-fill",
      "base-water-lake-river-fill",
      "base-water-lake-river-intermittent-fill",
      "base-land-cover-forest-fill",
      "base-land-cover-grass-fill",
      "base-land-cover-mangrove-fill",
      "base-land-cover-moss-fill",
      "base-land-cover-shrub-fill",
      "base-land-cover-snow-fill",
      "base-land-cover-wetland-fill",
      "base-land-cover-barren-fill",
      "base-land-cover-crop-fill",
      "base-bathymetry-depth-0-fill",
      "base-bathymetry-depth-1000-fill",
    ];
    for (const id of shouldBeExcluded) {
      expect(interactiveIds).not.toContain(id);
    }
  });

  it("still allows clicking things a user legitimately wants to inspect", () => {
    const interactiveIds = getInteractiveLayerIds(fakeMap, ALL_ITEMS);
    // land-use parcels (parks, cemeteries, ...) and infrastructure (piers,
    // airports, ...) are specific, bounded features — only the vast
    // background carpet got turned off, not everything under "base".
    expect(interactiveIds).toContain("base-land-use-park-fill");
    expect(interactiveIds.some((id) => id.startsWith("buildings-"))).toBe(true);
  });
});
