import { render, screen } from "@testing-library/react";
import LaunchContext from "@/lib/LaunchContext";
import ProfilePanel from "@/components/analysis/ProfilePanel";

function renderWithAnalysis(analysis) {
  return render(
    <LaunchContext.Provider value={{ analysis }}>
      <ProfilePanel isDark={false} />
    </LaunchContext.Provider>
  );
}

describe("ProfilePanel", () => {
  it("prompts to set a launch point when there is none", () => {
    renderWithAnalysis(null);
    screen.getByText("Set a launch point to analyze visibility.");
  });

  it("prompts to pick an observer once a launch point exists but nothing is selected yet", () => {
    renderWithAnalysis({
      launch: { lat: 37.79, lng: -122.4 },
      targetHeight: 100,
      shellRadius: 20,
      observer: null,
      profile: null,
    });
    screen.getByText("Click anywhere on the map to see whether that spot can see the launch.");
  });

  it("renders the fully-visible verdict and chart when nothing blocks the sightline", () => {
    renderWithAnalysis({
      launch: { lat: 37.79, lng: -122.4 },
      targetHeight: 100,
      shellRadius: 20,
      observer: { lat: 37.791, lng: -122.401 },
      profile: {
        totalDistance: 120,
        eyeHeight: 1.6,
        targetHeight: 100,
        shellRadius: 20,
        minAlt: -Infinity,
        frac: 1,
        theta: 14.6874,
        phi: 39.3518,
        score: 1,
        category: "good",
        hits: [],
      },
    });
    screen.getByText(/Visible — 100% of the shell/);
    screen.getByText(/Nothing blocks the shell — fully visible\./);
    screen.getByText(/Overall viewing quality: 100% \(Good spot\)/);
  });

  it("renders the blocked verdict with the required clearance height", () => {
    renderWithAnalysis({
      launch: { lat: 37.79, lng: -122.4 },
      targetHeight: 100,
      shellRadius: 20,
      observer: { lat: 37.791, lng: -122.401 },
      profile: {
        totalDistance: 100,
        eyeHeight: 1.6,
        targetHeight: 100,
        shellRadius: 20,
        minAlt: 143.6,
        frac: 0,
        theta: 16.2265,
        phi: 44.5379,
        score: 0,
        category: "blocked",
        hits: [{ distance: 20, height: 30, req: 143.6 }],
      },
    });
    screen.getByText(/Blocked — 0% of the shell/);
    screen.getByText(/Fully blocked — you'd need to reach 144m/);
    screen.getByText(/Overall viewing quality: 0% \(Blocked\)/);
  });

  it("shows the composite score separately from the raw line-of-sight fraction when they diverge", () => {
    // frac (line of sight alone) and score (frac x angular-size gate x
    // elevation comfort) tell different stories here on purpose: 80% clear
    // sightline, but a viewing angle that only rates "partially" comfortable.
    renderWithAnalysis({
      launch: { lat: 37.79, lng: -122.4 },
      targetHeight: 100,
      shellRadius: 20,
      observer: { lat: 37.791, lng: -122.401 },
      profile: {
        totalDistance: 120,
        eyeHeight: 1.6,
        targetHeight: 100,
        shellRadius: 20,
        minAlt: 90,
        frac: 0.804499,
        theta: 14.6874,
        phi: 39.3518,
        score: 0.4800383,
        category: "partial",
        hits: [{ distance: 60, height: 90, req: 90 }],
      },
    });
    screen.getByText(/Visible — 80% of the shell/);
    screen.getByText(/Overall viewing quality: 48% \(Partially blocked\)/);
  });

  it("labels a clear-but-badly-angled point as 'Bad angle', never 'Blocked'", () => {
    // This is the scenario the category split exists for: frac=1 (nothing
    // physically obstructs it) but score=0 (steep viewing angle) — must not
    // render the same as an actually building-blocked point.
    renderWithAnalysis({
      launch: { lat: 37.79, lng: -122.4 },
      targetHeight: 100,
      shellRadius: 20,
      observer: { lat: 37.791, lng: -122.401 },
      profile: {
        totalDistance: 100,
        eyeHeight: 1.6,
        targetHeight: 100,
        shellRadius: 20,
        minAlt: -Infinity,
        frac: 1,
        theta: 16.2265,
        phi: 44.5379,
        score: 0.0062075,
        category: "poor-angle",
        hits: [],
      },
    });
    screen.getByText(/Visible — 100% of the shell/);
    screen.getByText(/Overall viewing quality: 1% \(Bad angle\)/);
  });
});
