// Curated real-world fireworks-show presets. Selecting one drops a launch
// point at the show's approximate coordinates, sets the caliber to
// something realistic for that show, and flies the map to it — so a first-
// time user can jump straight from "I opened the app" to "can I see the
// Macy's show from my apartment" without knowing where East River launch
// barges sit.
//
// Coordinates are meant to be *approximate* — Macy's alone rotates barges
// each year, DC's National Mall show fires from several points, and half
// the international shows quote different mortar positions in different
// news reports. Each entry picks one plausible on-water / on-landmark
// point that puts the analysis circle over the actual viewing catchment;
// the app is a visibility estimator, not a permit lookup.
//
// Caliber is the *largest* shell typically used, per each show's public
// coverage — pyrotechnic operators do fire multiple sizes, but the
// caliber slider here maps directly to the shell that determines the
// "top of the burst" the app renders.

/**
 * @typedef {object} FireworksPreset
 * @property {string} id - stable slug, used as React key + URL param
 * @property {string} name - short display name
 * @property {string} city - "City, Region" for the secondary line
 * @property {string} occasion - what the show is (Independence Day, NYE, ...)
 * @property {number} lng
 * @property {number} lat
 * @property {number} caliber - inches; matches the STANDARD_CALIBERS_INCHES scale
 * @property {number} [zoom] - default 14; some shows want a wider view (Sydney), some tighter (Disney)
 */

/** @type {FireworksPreset[]} */
export const FIREWORKS_PRESETS = [
  {
    id: "nyc-macys",
    name: "Macy's 4th of July",
    city: "New York, USA",
    occasion: "Independence Day, East River barges",
    lng: -73.9930,
    lat: 40.7080,
    caliber: 12,
    zoom: 13,
  },
  {
    id: "sf-pier39",
    name: "Fisherman's Wharf 4th",
    city: "San Francisco, USA",
    occasion: "Independence Day, Aquatic Park / Pier 39",
    lng: -122.4160,
    lat: 37.8090,
    caliber: 8,
  },
  {
    id: "boston-esplanade",
    name: "Boston Pops Esplanade",
    city: "Boston, USA",
    occasion: "Independence Day, Charles River",
    lng: -71.0740,
    lat: 42.3540,
    caliber: 8,
  },
  {
    id: "dc-nationalmall",
    name: "National Mall 4th",
    city: "Washington DC, USA",
    occasion: "Independence Day, Washington Monument",
    lng: -77.0353,
    lat: 38.8895,
    caliber: 10,
    zoom: 13,
  },
  {
    id: "la-grandpark",
    name: "Grand Park NYE",
    city: "Los Angeles, USA",
    occasion: "New Year's Eve, downtown LA",
    lng: -118.2465,
    lat: 34.0555,
    caliber: 6,
  },
  {
    id: "disneyland-anaheim",
    name: "Disneyland castle show",
    city: "Anaheim, USA",
    occasion: "Nightly, Sleeping Beauty Castle",
    lng: -117.9190,
    lat: 33.8121,
    caliber: 4,
    zoom: 15,
  },
  {
    id: "disney-magickingdom",
    name: "Magic Kingdom Happily Ever After",
    city: "Orlando, USA",
    occasion: "Nightly, Cinderella Castle",
    lng: -81.5811,
    lat: 28.4193,
    caliber: 4,
    zoom: 15,
  },
  {
    id: "sydney-harbour",
    name: "Harbour Bridge NYE",
    city: "Sydney, Australia",
    occasion: "New Year's Eve, Sydney Harbour",
    lng: 151.2108,
    lat: -33.8520,
    caliber: 12,
    zoom: 13,
  },
  {
    id: "london-thames",
    name: "London Eye NYE",
    city: "London, UK",
    occasion: "New Year's Eve, Thames",
    lng: -0.1195,
    lat: 51.5033,
    caliber: 8,
  },
  {
    id: "paris-eiffel",
    name: "Eiffel Tower Bastille Day",
    city: "Paris, France",
    occasion: "14 Juillet, Champ-de-Mars",
    lng: 2.2945,
    lat: 48.8584,
    caliber: 10,
  },
  {
    id: "rio-copacabana",
    name: "Copacabana Réveillon",
    city: "Rio de Janeiro, Brazil",
    occasion: "New Year's Eve, Copacabana beach",
    lng: -43.1785,
    lat: -22.9720,
    caliber: 10,
    zoom: 13,
  },
  {
    id: "tokyo-sumida",
    name: "Sumidagawa Hanabi",
    city: "Tokyo, Japan",
    occasion: "Late-July, Sumida River",
    lng: 139.8034,
    lat: 35.7100,
    caliber: 8,
  },
];

export function findPreset(id) {
  return FIREWORKS_PRESETS.find((p) => p.id === id) ?? null;
}
