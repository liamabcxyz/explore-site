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
      height: 100,
      shellRadius: 20,
      observer: null,
      profile: null,
    });
    screen.getByText("Click anywhere on the map to see whether that spot can see the launch.");
  });

  it("renders the fully-visible verdict and chart when nothing blocks the sightline", () => {
    renderWithAnalysis({
      launch: { lat: 37.79, lng: -122.4 },
      height: 100,
      shellRadius: 20,
      observer: { lat: 37.791, lng: -122.401 },
      profile: {
        totalDistance: 120,
        eyeHeight: 1.6,
        targetHeight: 100,
        shellRadius: 20,
        minAlt: -Infinity,
        frac: 1,
        hits: [],
      },
    });
    screen.getByText(/Visible — 100% of the shell/);
    screen.getByText(/Nothing blocks the shell — fully visible\./);
  });

  it("renders the blocked verdict with the required clearance height", () => {
    renderWithAnalysis({
      launch: { lat: 37.79, lng: -122.4 },
      height: 100,
      shellRadius: 20,
      observer: { lat: 37.791, lng: -122.401 },
      profile: {
        totalDistance: 100,
        eyeHeight: 1.6,
        targetHeight: 100,
        shellRadius: 20,
        minAlt: 143.6,
        frac: 0,
        hits: [{ distance: 20, height: 30, req: 143.6 }],
      },
    });
    screen.getByText(/Blocked — 0% of the shell/);
    screen.getByText(/Fully blocked — you'd need to reach 144m/);
  });
});
