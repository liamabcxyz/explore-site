/**
 * A shell's burst height and radius are both determined by its caliber
 * (烟花可视性数学模型.md §1.4): z_b ≈ 30·c meters, R ≈ 6.9·c meters, c in inches.
 * Kept generic — doesn't validate against STANDARD_CALIBERS_INCHES, since
 * restricting to real shell sizes is a UI concern, not a math one.
 */

export const STANDARD_CALIBERS_INCHES = [3, 4, 6, 8, 10, 12];

export function deriveShellParams(caliberInches) {
  return {
    targetHeight: 30 * caliberInches,
    shellRadius: 6.9 * caliberInches,
  };
}
