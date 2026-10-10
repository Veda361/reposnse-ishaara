/**
 * Normalized provider-independent representation of a physical location.
 * Encapsulates canonical Google place identifiers and SerpApi discovery metadata
 * without exposing raw external provider JSON.
 */
export type LocationProviderName = "google_maps" | "serpapi" | "google_geocoding";

export interface ResolvedLocation {
  latitude: number;
  longitude: number;
  formattedAddress: string;
  displayName?: string;
  provider: LocationProviderName;
  googlePlaceId?: string;
  serpApiDataId?: string;
  serpApiDataCid?: string;
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string;
}

/**
 * Standard search query parameters for location resolution.
 */
export interface LocationSearchParams {
  query: string;
  limit?: number;
  latitude?: number;
  longitude?: number;
  radius?: number;
}

/**
 * Interface contract for external geospatial search providers.
 */
export interface ILocationProvider {
  readonly name: "google_maps" | "serpapi";
  searchPlaces(params: LocationSearchParams): Promise<ResolvedLocation[]>;
  isAvailable(): boolean;
}

/**
 * Parameters for forward geocoding requests.
 */
export interface GeocodeParams {
  address: string;
  languageCode?: string;
  regionCode?: string;
}

/**
 * Parameters for reverse geocoding requests.
 */
export interface ReverseGeocodeParams {
  latitude: number;
  longitude: number;
  languageCode?: string;
  regionCode?: string;
}

/**
 * Interface contract for external geocoding providers.
 */
export interface IGeocodingProvider {
  readonly name: "google_geocoding";
  geocode(params: GeocodeParams): Promise<ResolvedLocation[]>;
  reverseGeocode(params: ReverseGeocodeParams): Promise<ResolvedLocation | null>;
  isAvailable(): boolean;
}
