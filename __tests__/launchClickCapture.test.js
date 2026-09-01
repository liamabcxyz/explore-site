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
      })
    ).toBe(true);
  });

  it("doesn't capture anything when not placing and no launch point exists", () => {
    expect(
      isVantageClick({
        placing: false,
        launch: null,
        clickLngLat: { lng: launch.lng, lat: launch.lat },
      })
    ).toBe(false);
  });

  it("does not capture in-radius clicks unless observer-place mode is on", () => {
    expect(
      isVantageClick({
        placing: false,
        placingObserver: false,
        launch,
        clickLngLat: offsetBy(500, 0),
      })
    ).toBe(false);
  });

  it("captures observer picks anywhere once place-observer mode is on", () => {
    expect(
      isVantageClick({
        placing: false,
        placingObserver: true,
        launch,
        clickLngLat: offsetBy(20000, 0),
      })
    ).toBe(true);
  });

  it("leaves map clicks alone when a launch exists but nobody is placing", () => {
    expect(
      isVantageClick({
        placing: false,
        placingObserver: false,
        launch,
        clickLngLat: offsetBy(2000, 0),
      })
    ).toBe(false);
  });
});
