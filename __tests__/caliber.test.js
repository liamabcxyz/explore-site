import { deriveShellParams, STANDARD_CALIBERS_INCHES } from "@/lib/viewshed/caliber";

describe("deriveShellParams", () => {
  it.each([
    [3, 90, 20.7],
    [4, 120, 27.6],
    [6, 180, 41.4],
    [8, 240, 55.2],
    [10, 300, 69.0],
    [12, 360, 82.8],
  ])("caliber %i\" -> targetHeight %im, shellRadius %im", (caliber, targetHeight, shellRadius) => {
    const result = deriveShellParams(caliber);
    expect(result.targetHeight).toBeCloseTo(targetHeight);
    expect(result.shellRadius).toBeCloseTo(shellRadius);
  });

  it("doesn't restrict to the standard caliber list — that's a UI concern", () => {
    const result = deriveShellParams(5);
    expect(result.targetHeight).toBeCloseTo(150);
    expect(result.shellRadius).toBeCloseTo(34.5);
  });

  it("exports the standard caliber list used to drive the UI selector", () => {
    expect(STANDARD_CALIBERS_INCHES).toEqual([3, 4, 6, 8, 10, 12]);
  });
});
