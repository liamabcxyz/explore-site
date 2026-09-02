import { buildReportBundle } from "@/lib/debug/bundle";
import { clearFetchTrace, traceFetch } from "@/lib/debug/trace";
import { reportViewshedPerf } from "@/lib/perf";
import { setPinnedRelease } from "@/lib/stacReleaseState";

const analysis = {
  launch: { lat: 40.71, lng: -73.99 },
  observer: { lat: 40.72, lng: -73.94 },
  caliber: 12,
  targetHeight: 360,
  shellRadius: 83,
  observerBuilding: null,
  mode: "corridor",
  buildingsConsidered: 42,
  analysisRadiusMeters: 1500,
  corridorBufferMeters: 200,
  profile: {
    totalDistance: 4200,
    eyeHeight: 1.6,
    observerAbsAlt: 1.6,
    targetAbsAlt: 360,
    targetApparentAlt: 358,
    observerGroundElev: 0,
    launchElev: 0,
    minAlt: 200,
    frac: 0.4,
    theta: 0.9,
    phi: 4.9,
    score: 0.35,
    category: "partial",
    hits: [
      {
        name: "Corner Tower",
        distance: 500,
        height: 200,
        confidence: "medium",
        req: 200,
        footprint: [
          [[-73.985, 40.715], [-73.984, 40.715], [-73.984, 40.716], [-73.985, 40.716], [-73.985, 40.715]],
        ],
      },
    ],
    terrainProfile: Array.from({ length: 210 }, (_, i) => ({ distance: i * 20, elevation: 0 })),
  },
};

describe("buildReportBundle", () => {
  beforeEach(() => {
    clearFetchTrace();
    setPinnedRelease({ releaseId: null, releaseUrl: null });
  });

  it("packs the three input streams — auto-captured, user-provided, annotations — into one JSON-safe object", () => {
    setPinnedRelease({ releaseId: "2026-01-24", releaseUrl: "https://example/release" });
    const bundle = buildReportBundle({
      analysis,
      viewerLevel: { mode: "ground", floor: 1 },
      user: { description: "Can see from here IRL.", expected: "visible", extraContext: "There's a crane." },
      annotations: [
        { id: "a1", kind: "building", lat: 40.71, lng: -73.98, building: { id: "b", name: "X" }, category: "wrong-blocker", note: "" },
      ],
    });
    expect(bundle.schemaVersion).toBe(1);
    expect(bundle.user).toEqual({
      description: "Can see from here IRL.",
      expected: "visible",
      extraContext: "There's a crane.",
    });
    expect(bundle.annotations).toHaveLength(1);
    expect(bundle.stac.releaseId).toBe("2026-01-24");
    expect(bundle.analysis.caliber).toBe(12);
    expect(bundle.app.name).toBe("vantage");
  });

  it("strips building footprints down to centroids to keep the bundle pastable", () => {
    const bundle = buildReportBundle({ analysis });
    const [hit] = bundle.analysis.profile.hits;
    expect(hit.footprint).toBeUndefined();
    expect(hit.centroid).toEqual({
      lat: expect.any(Number),
      lng: expect.any(Number),
    });
  });

  it("downsamples the terrain profile so a 210-sample sightline doesn't blow up the JSON", () => {
    const bundle = buildReportBundle({ analysis });
    expect(bundle.analysis.profile.terrainProfile.length).toBeLessThanOrEqual(70);
    expect(bundle.analysis.profile.terrainProfile.length).toBeGreaterThan(1);
  });

  it("snapshots the latest perf metrics", () => {
    reportViewshedPerf({ queryMs: 320, computeMs: 4200, buildingCount: 7170, cellCount: 2220 });
    const bundle = buildReportBundle({ analysis });
    expect(bundle.perf).toMatchObject({ queryMs: 320, computeMs: 4200 });
  });

  it("snapshots the fetch trace as a defensive copy", async () => {
    await traceFetch("stac", "https://a/catalog.json", async () => ({
      status: 200,
      ok: true,
      headers: { get: () => "1024" },
    }));
    const bundle = buildReportBundle({ analysis });
    expect(bundle.fetchTrace).toHaveLength(1);
    expect(bundle.fetchTrace[0]).toMatchObject({ source: "stac", status: 200 });
  });

  it("survives being called with no user block by defaulting to empty strings/nulls", () => {
    const bundle = buildReportBundle({ analysis });
    expect(bundle.user).toEqual({ description: "", expected: null, extraContext: "" });
    expect(bundle.annotations).toEqual([]);
  });

  it("produces JSON-serializable output (no circular refs, no undefined leaks)", () => {
    const bundle = buildReportBundle({ analysis });
    expect(() => JSON.stringify(bundle)).not.toThrow();
  });
});
