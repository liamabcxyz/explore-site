import { render, screen } from "@testing-library/react";
import LaunchContext from "@/lib/LaunchContext";
import ProfilePanel from "@/components/analysis/ProfilePanel";

function renderWithAnalysis(analysis, { viewerLevel, setViewerLevel } = {}) {
  // setClickCapturePredicate / isVantageClickAt are real context surface
  // added for MapView.jsx's click deferral (lib/launchClickCapture.js);
  // ProfilePanel doesn't touch either one, so plain no-ops keep the mock's
  // shape aligned with LaunchProvider without teaching the tests to care.
  const setClickCapturePredicate = () => {};
  const isVantageClickAt = () => false;
  return render(
    <LaunchContext.Provider
      value={{ analysis, viewerLevel, setViewerLevel, setClickCapturePredicate, isVantageClickAt }}
    >
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
        hits: [{ distance: 20, height: 30, confidence: "low", req: 143.6 }],
      },
    });
    screen.getByText(/Blocked — 0% of the shell/);
    screen.getByText(/Fully blocked — you'd need to reach 144m/);
    screen.getByText(/Overall viewing quality: 0% \(Blocked\)/);
    screen.getByText("Height is a rough estimate — no direct data for this building.");
  });

  it("shows the confidence note for whichever building actually drives the verdict", () => {
    // Two hits — the one with the higher req (the near building) is the
    // real blocker, so its confidence is what should be shown, not the
    // farther building's.
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
        hits: [
          { distance: 45, height: 51, confidence: "high", req: 111.38 },
          { distance: 20, height: 30, confidence: "medium", req: 143.6 },
        ],
      },
    });
    screen.getByText("Height is estimated from floor count or community-sourced data.");
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

  it("shows the viewer-height selector when the observer point sits on a building", () => {
    renderWithAnalysis(
      {
        launch: { lat: 37.79, lng: -122.4 },
        targetHeight: 100,
        shellRadius: 20,
        observer: { lat: 37.791, lng: -122.401 },
        observerBuilding: { height: 64, confidence: "medium", maxFloors: 20 },
        profile: {
          totalDistance: 100,
          eyeHeight: 1.6,
          targetHeight: 100,
          shellRadius: 20,
          minAlt: -Infinity,
          frac: 1,
          theta: 16.2265,
          phi: 44.5379,
          score: 1,
          category: "good",
          hits: [],
        },
      },
      { viewerLevel: { mode: "ground", floor: 1 }, setViewerLevel: () => {} }
    );
    screen.getByText("This spot is on a ~64m building — how high up are you?");
    screen.getByRole("button", { name: "Ground" });
    screen.getByRole("button", { name: "Floor" });
    screen.getByRole("button", { name: "Rooftop" });
    // Floor mode not selected -> no floor slider yet
    expect(screen.queryByText(/Floor \d+ of ~20/)).toBeNull();
    // Building height isn't "high" confidence -> the same trust note as the
    // blocker confidence line, reused for consistency
    screen.getByText("Height is estimated from floor count or community-sourced data.");
  });

  it("shows the floor slider once floor mode is selected", () => {
    renderWithAnalysis(
      {
        launch: { lat: 37.79, lng: -122.4 },
        targetHeight: 100,
        shellRadius: 20,
        observer: { lat: 37.791, lng: -122.401 },
        observerBuilding: { height: 64, confidence: "high", maxFloors: 20 },
        profile: {
          totalDistance: 100,
          eyeHeight: 10.2,
          targetHeight: 100,
          shellRadius: 20,
          minAlt: -Infinity,
          frac: 1,
          theta: 16.2265,
          phi: 44.5379,
          score: 1,
          category: "good",
          hits: [],
        },
      },
      { viewerLevel: { mode: "floor", floor: 4 }, setViewerLevel: () => {} }
    );
    screen.getByText("Floor 4 of ~20");
  });
});
