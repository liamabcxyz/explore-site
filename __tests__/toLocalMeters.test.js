import { makeLocalProjector } from "@/lib/geo/toLocalMeters";

describe("makeLocalProjector", () => {
  it("maps the origin itself to (0, 0)", () => {
    const projector = makeLocalProjector(37.7925, -122.397);
    const { x, y } = projector.toLocal(37.7925, -122.397);
    expect(x).toBeCloseTo(0, 6);
    expect(y).toBeCloseTo(0, 6);
  });

  it("round-trips lat/lng -> local meters -> lat/lng at city-block scale", () => {
    const projector = makeLocalProjector(37.7925, -122.397);
    const original = { lat: 37.795, lng: -122.394 };
    const { x, y } = projector.toLocal(original.lat, original.lng);
    const back = projector.toLatLng(x, y);
    expect(back.lat).toBeCloseTo(original.lat, 9);
    expect(back.lng).toBeCloseTo(original.lng, 9);
  });

  it("moving 1 degree north is ~111.32km regardless of longitude scale", () => {
    const projector = makeLocalProjector(37.7925, -122.397);
    const { y } = projector.toLocal(38.7925, -122.397);
    expect(y).toBeCloseTo(111320, 0);
  });
});
