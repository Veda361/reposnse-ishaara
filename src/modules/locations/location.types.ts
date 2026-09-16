/**
 * Normalized provider-independent representation of a physical location.
 * Encapsulates canonical Google place identifiers and SerpApi discovery metadata
 * without exposing raw external provider JSON.
 */
export interface ResolvedLocation {
  latitude: number;
  longitude: number;
  formattedAddress: string;
  displayName?: string;
  provider: "google_maps" | "serpapi";
  googlePlaceId?: string;
  serpApiDataId?: string;
  serpApiDataCid?: string;
  city?: string;
  state?: string;
  country?: string;
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
 * Interface contract for external geospatial providers.
 */
export interface ILocationProvider {
  readonly name: "google_maps" | "serpapi";
  searchPlaces(params: LocationSearchParams): Promise<ResolvedLocation[]>;
  isAvailable(): boolean;
}
