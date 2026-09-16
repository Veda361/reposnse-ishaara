export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export interface LineStringGeometry {
  type: "LineString";
  coordinates: Array<[number, number]>; // GeoJSON canonical order: [longitude, latitude]
}

export interface RouteRequest {
  origin: GeoPoint;
  destination: GeoPoint;
  mode?: "DRIVE" | "TWO_WHEELER";
}

export interface RouteResult {
  provider: string;
  geometry: LineStringGeometry;
  distanceMeters: number;
  durationSeconds: number;
  encodedPolyline?: string;
  computedAt: Date;
}

export interface RoutingProvider {
  readonly name: string;
  isAvailable(): boolean;
  computeRoute(request: RouteRequest): Promise<RouteResult>;
}
