import { makeLocalProjector } from "@/lib/geo/toLocalMeters";

/**
 * A building can only block a sightline within `radiusMeters` of `point` if
 * some part of its footprint falls within that radius (every sightline the
 * viewshed grid tests runs from an observer inside that radius to `point`
 * itself, so nothing farther out than the radius can ever sit on one of
 * those segments). `querySourceFeatures` returns whatever's in the loaded
 * viewport regardless of how far that is from the launch point — for a
 * street-level view that can be thousands of buildings the occlusion math
 * never needed to look at. Filtering here, before handing buildings to
 * computeViewshed (main thread or worker), is a straight cut to the O(cells
 * x buildings) cost, not just a relocation of it.
 *
 * Checked by vertex distance rather than true edge-to-point distance —
 * footprints are meters-to-tens-of-meters across, negligible next to a
 * radius measured in hundreds of meters, so the sliver of an edge that
 * could be closer to `point` than every one of its own vertices doesn't
 * matter. MARGIN_METERS absorbs it anyway.
 */
const MARGIN_METERS = 50;

export function filterBuildingsNearPoint(buildings, point, radiusMeters) {
  const projector = makeLocalProjector(point.lat, point.lng);
  const limitSq = (radiusMeters + MARGIN_METERS) ** 2;
  return buildings.filter((building) =>
    building.footprint.some((ring) =>
      ring.some(([lng, lat]) => {
        const { x, y } = projector.toLocal(lat, lng);
        return x * x + y * y <= limitSq;
      })
    )
  );
}
