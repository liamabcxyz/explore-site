import { parseLaunchUrlState, writeLaunchUrlState } from "@/lib/launchUrlState";

describe("parseLaunchUrlState", () => {
  it("returns all-undefined for an empty search string", () => {
    expect(parseLaunchUrlState("")).toEqual({
      launch: undefined,
      caliber: undefined,
      observer: undefined,
      viewerLevel: undefined,
      showRooftopLayer: undefined,
    });
  });

  it("parses a launch point", () => {
    expect(parseLaunchUrlState("?launch=40.7128,-74.006")).toMatchObject({
      launch: { lat: 40.7128, lng: -74.006 },
    });
  });

  it("rejects malformed launch coords rather than returning garbage", () => {
    // Wrong shape, non-numeric, out of range — all should be undefined, not
    // NaN/partial. Better to lose the URL restore silently than restore a
    // half-set launch point in an impossible spot.
    expect(parseLaunchUrlState("?launch=abc").launch).toBeUndefined();
    expect(parseLaunchUrlState("?launch=40.7").launch).toBeUndefined();
    expect(parseLaunchUrlState("?launch=91,0").launch).toBeUndefined();
    expect(parseLaunchUrlState("?launch=0,181").launch).toBeUndefined();
  });

  it("only accepts a caliber value that matches a STANDARD_CALIBERS_INCHES entry", () => {
    expect(parseLaunchUrlState("?caliber=6").caliber).toBe(6);
    expect(parseLaunchUrlState("?caliber=5").caliber).toBeUndefined();
    expect(parseLaunchUrlState("?caliber=twelve").caliber).toBeUndefined();
  });

  it("parses viewer level with a floor when mode=floor", () => {
    expect(parseLaunchUrlState("?level=floor&floor=7").viewerLevel).toEqual({ mode: "floor", floor: 7 });
    expect(parseLaunchUrlState("?level=rooftop").viewerLevel).toEqual({ mode: "rooftop", floor: 1 });
    expect(parseLaunchUrlState("?level=ground").viewerLevel).toEqual({ mode: "ground", floor: 1 });
    expect(parseLaunchUrlState("?level=basement").viewerLevel).toBeUndefined();
  });

  it("only reads rooftop=1 as an on toggle (not 0, not 'true')", () => {
    // Chosen to be explicit — `?rooftop=1` is the ONLY encoding this module
    // writes, so decoding anything else as on would let a malformed URL
    // silently claim a state we never write.
    expect(parseLaunchUrlState("?rooftop=1").showRooftopLayer).toBe(true);
    expect(parseLaunchUrlState("?rooftop=0").showRooftopLayer).toBeUndefined();
    expect(parseLaunchUrlState("?rooftop=true").showRooftopLayer).toBeUndefined();
  });
});

describe("writeLaunchUrlState", () => {
  const launch = { lat: 40.7128, lng: -74.006 };

  it("round-trips a full state through parse ∘ write ∘ parse", () => {
    const state = {
      launch,
      caliber: 8,
      observer: { lat: 40.715, lng: -74.005 },
      viewerLevel: { mode: "floor", floor: 12 },
      showRooftopLayer: true,
    };
    expect(parseLaunchUrlState(writeLaunchUrlState("", state))).toEqual(state);
  });

  it("preserves keys it doesn't own (mode, feature — the page.jsx writer)", () => {
    // These are the two keys app/map/page.jsx already writes; this test
    // documents why the two writers coexist without a merge conflict.
    const before = "mode=inspect&feature=buildings.building.abc";
    const after = writeLaunchUrlState(before, { launch });
    const parsed = new URLSearchParams(after);
    expect(parsed.get("mode")).toBe("inspect");
    expect(parsed.get("feature")).toBe("buildings.building.abc");
    expect(parsed.get("launch")).toBe("40.71280,-74.00600");
  });

  it("removes keys for absent fields rather than writing them empty", () => {
    const before = "launch=40.7,-74.0&caliber=6&rooftop=1&level=rooftop";
    const after = writeLaunchUrlState(before, {});
    expect(after).toBe("");
  });

  it("doesn't write level=ground (that's the default; wastes a param)", () => {
    const after = writeLaunchUrlState("", { launch, viewerLevel: { mode: "ground", floor: 1 } });
    expect(new URLSearchParams(after).has("level")).toBe(false);
  });

  it("only writes rooftop=1 when the toggle is on", () => {
    expect(writeLaunchUrlState("", { launch, showRooftopLayer: true })).toContain("rooftop=1");
    expect(writeLaunchUrlState("", { launch, showRooftopLayer: false })).not.toContain("rooftop");
  });
});
