import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import CitySearch from "@/components/landing/CitySearch";

const SF_RESULT = {
  name: "San Francisco",
  type: "locality",
  region: "California",
  country: "United States",
  lat: 37.7749,
  lon: -122.4194,
};

describe("CitySearch", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("navigates to the map at the suggested city", () => {
    const onNavigate = jest.fn();
    render(<CitySearch mode="theme-dark" onNavigate={onNavigate} />);

    fireEvent.click(screen.getByText("San Francisco"));
    expect(onNavigate).toHaveBeenCalledWith("/map#14.5/37.7749/-122.4194");
  });

  it("searches the geocoder and jumps to the first result on Search", async () => {
    const onNavigate = jest.fn();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [SF_RESULT] }),
    });

    render(<CitySearch mode="theme-dark" onNavigate={onNavigate} />);
    fireEvent.change(screen.getByLabelText("Search for a city"), {
      target: { value: "San Francisco" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() => {
      expect(onNavigate).toHaveBeenCalledWith("/map#14.5/37.7749/-122.4194");
    });
  });

  it("lets the user pick a specific result from the dropdown", async () => {
    const onNavigate = jest.fn();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          SF_RESULT,
          { name: "San Jose", type: "locality", lat: 37.3382, lon: -121.8863 },
        ],
      }),
    });

    render(<CitySearch mode="theme-dark" onNavigate={onNavigate} />);
    fireEvent.change(screen.getByLabelText("Search for a city"), {
      target: { value: "San" },
    });

    await waitFor(() => screen.getByText("San Jose"));
    fireEvent.click(screen.getByText("San Jose"));

    expect(onNavigate).toHaveBeenCalledWith("/map#14.5/37.3382/-121.8863");
  });
});
