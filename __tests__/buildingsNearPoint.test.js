import { filterBuildingsNearPoint } from "@/lib/geo/buildingsNearPoint";

const METERS_PER_DEGREE = 111320;
const point = { lat: 0, lng: 0 };
const toLngLat = (x, y) => [x / METERS_PER_DEGREE, y / METERS_PER_DEGREE];

function squareAt(xMin, xMax, yMin, yMax) {
  return {
    height: 20,
    footprint: [[
      toLngLat(xMin, yMin), toLngLat(xMax, yMin), toLngLat(xMax, yMax), toLngLat(xMin, yMax), toLngLat(xMin, yMin),
    ]],
  };
}

describe("filterBuildingsNearPoint", () => {
  it("keeps a building entirely inside the radius", () => {
    const near = squareAt(10, 20, 10, 20); // ~28m from origin at the nearest corner
    expect(filterBuildingsNearPoint([near], point, 500)).toEqual([near]);
  });

  it("drops a building entirely outside radius + margin", () => {
    // nearest corner at (1000,0), 1000m out — well past 500 + 50 margin
    const far = squareAt(1000, 1010, -5, 5);
    expect(filterBuildingsNearPoint([far], point, 500)).toEqual([]);
  });

  it("keeps a building just inside the margin band, past the raw radius", () => {
    // nearest corner at 520m — outside the 500m radius itself, but inside
    // the 500+50=550m margin band
    const inMargin = squareAt(520, 530, -5, 5);
    expect(filterBuildingsNearPoint([inMargin], point, 500)).toEqual([inMargin]);
  });

  it("drops a building just past the margin band", () => {
    const pastMargin = squareAt(560, 570, -5, 5);
    expect(filterBuildingsNearPoint([pastMargin], point, 500)).toEqual([]);
  });

  it("keeps a building that straddles the boundary (only one vertex within range)", () => {
    // spans 400m to 600m — the near corners are well within radius even
    // though the far corners are past it
    const straddling = squareAt(400, 600, -5, 5);
    expect(filterBuildingsNearPoint([straddling], point, 500)).toEqual([straddling]);
  });

  it("filters a mixed list down to just the nearby ones", () => {
    const near = squareAt(10, 20, 10, 20);
    const far = squareAt(1000, 1010, -5, 5);
    expect(filterBuildingsNearPoint([near, far], point, 500)).toEqual([near]);
  });
});
