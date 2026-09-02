import { buildSightlineDebugReport } from "@/lib/viewshed/debugReport";

const launch = { lat: 37.79, lng: -122.4 };
const observer = { lat: 37.795, lng: -122.395 };

function baseAnalysis(overrides = {}) {
  return {
    launch,
    observer,
    caliber: 6,
    targetHeight: 120,
    shellRadius: 25,
    mode: "grid",
    buildingsConsidered: 42,
    analysisRadiusMeters: 1500,
    corridorBufferMeters: 200,
    observerBuilding: null,
    profile: {
      totalDistance: 600,
      eyeHeight: 1.6,
      observerAbsAlt: 1.6,
      targetAbsAlt: 120,
      targetApparentAlt: 120,
      observerGroundElev: 0,
      launchElev: 0,
      minAlt: -Infinity,
      frac: 1,
      theta: 3.2,
      phi: 11.4,
      score: 0.9,
      category: "good",
      hits: [],
      terrainProfile: [
        { distance: 0, elevation: 0 },
        { distance: 600, elevation: 0 },
      ],
      coverageGaps: [],
      dataIncomplete: false,
    },
    ...overrides,
  };
}

describe("buildSightlineDebugReport", () => {
  it("returns a placeholder when there's no profile yet", () => {
    expect(buildSightlineDebugReport(null)).toMatch(/place both a launch point/i);
    expect(buildSightlineDebugReport({ launch, observer: null, profile: null })).toMatch(/place both a launch point/i);
  });

  it("labels the fetch mode and echoes key geometry inputs", () => {
    const report = buildSightlineDebugReport(baseAnalysis());
    expect(report).toContain("grid —");
    expect(report).toContain("37.790000, -122.400000"); // launch
    expect(report).toContain("37.795000, -122.395000"); // observer
    expect(report).toContain("600m");
  });

  it("explains the corridor mode with the buffer width", () => {
    const report = buildSightlineDebugReport(baseAnalysis({ mode: "corridor" }));
    expect(report).toContain("corridor —");
    expect(report).toContain("200m-wide strip");
  });

  it("lists each hit with its distance, height and req, plus a binding-constraint note", () => {
    const analysis = baseAnalysis({
      profile: {
        ...baseAnalysis().profile,
        minAlt: 130,
        frac: 0,
        hits: [
          {
            distance: 300,
            height: 130,
            confidence: "high",
            req: 130,
            name: "Clock Tower",
            footprint: [[[-122.398, 37.792], [-122.397, 37.792], [-122.397, 37.793], [-122.398, 37.792]]],
          },
        ],
      },
    });
    const report = buildSightlineDebugReport(analysis);
    expect(report).toContain('"Clock Tower"');
    expect(report).toContain("300m from viewing spot");
    expect(report).toContain("a building (see hit list above)");
  });

  it("flags terrain as the binding constraint when minAlt exceeds every hit's req", () => {
    const analysis = baseAnalysis({
      profile: {
        ...baseAnalysis().profile,
        minAlt: 200,
        hits: [
          { distance: 300, height: 50, confidence: "high", req: 60, name: "Short Building", footprint: [[[0, 0], [0, 0], [0, 0]]] },
        ],
      },
    });
    const report = buildSightlineDebugReport(analysis);
    expect(report).toContain("terrain (ground itself), not a building");
  });

  it("reports no coverage gaps cleanly, and lists them when present", () => {
    const clean = buildSightlineDebugReport(baseAnalysis());
    expect(clean).toContain("No coverage gaps");

    const withGap = buildSightlineDebugReport(baseAnalysis({
      profile: {
        ...baseAnalysis().profile,
        dataIncomplete: true,
        coverageGaps: [{ fromMeters: 100, toMeters: 250, source: "buildings" }],
      },
    }));
    expect(withGap).toContain("buildings: from 100m to 250m");
  });

  it("includes a trailing JSON block with footprints stripped to centroids", () => {
    const analysis = baseAnalysis({
      profile: {
        ...baseAnalysis().profile,
        hits: [
          {
            distance: 300,
            height: 130,
            confidence: "high",
            req: 130,
            name: "Clock Tower",
            footprint: [[[-122.398, 37.792], [-122.397, 37.792], [-122.397, 37.793], [-122.398, 37.792]]],
          },
        ],
      },
    });
    const report = buildSightlineDebugReport(analysis);
    const jsonStart = report.indexOf("{");
    const json = JSON.parse(report.slice(jsonStart));
    expect(json.hits[0].footprint).toBeUndefined();
    expect(json.hits[0].centroid.lat).toBeCloseTo(37.7923, 3);
    expect(json.terrainProfile).toBeUndefined();
  });
});
