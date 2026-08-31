import { isVantageClick } from "@/lib/launchClickCapture";
import { makeLocalProjector } from "@/lib/geo/toLocalMeters";

const launch = { lat: 37.7925, lng: -122.397 };
const projector = makeLocalProjector(launch.lat, launch.lng);
function offsetBy(xMeters, yMeters) {
  return { lng: projector.toLatLng(xMeters, yMeters).lng, lat: projector.toLatLng(xMeters, yMeters).lat };
}

describe("isVantageClick", () => {
  it("captures every click while placing, no matter where it lands", () => {
    expect(
      isVantageClick({
        placing: true,
        launch: null,
        clickLngLat: offsetBy(10000, 0),
        analysisRadiusMeters: 1500,
      })
    ).toBe(true);
  });

  it("doesn't capture anything when not placing and no launch point exists", () => {
    expect(
      isVantageClick({
        placing: false,
        launch: null,
        clickLngLat: { lng: launch.lng, lat: launch.lat },
        analysisRadiusMeters: 1500,
      })
    ).toBe(false);
  });

  it("captures observer picks inside the analysis radius once a launch point exists", () => {
    expect(
      isVantageClick({
        placing: false,
        launch,
        clickLngLat: offsetBy(500, 0),
        analysisRadiusMeters: 1500,
      })
    ).toBe(true);
  });

  it("leaves clicks outside the radius alone (feature-inspect stays available there)", () => {
    expect(
      isVantageClick({
        placing: false,
        launch,
        clickLngLat: offsetBy(2000, 0),
        analysisRadiusMeters: 1500,
      })
    ).toBe(false);
  });

  it("captures a boundary click (right at the radius)", () => {
    // Mirror of LaunchPointControl.jsx's own observer-click guard —
    // `Math.hypot(x, y) > ANALYSIS_RADIUS` is the exclusion, so exactly
    // equal is still consumed.
    expect(
      isVantageClick({
        placing: false,
        launch,
        clickLngLat: offsetBy(1500, 0),
        analysisRadiusMeters: 1500,
      })
    ).toBe(true);
  });
});
