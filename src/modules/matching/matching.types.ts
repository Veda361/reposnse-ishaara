export type CompatibilityLevel = "HIGH" | "MEDIUM" | "LOW";

export interface RouteMatchResult {
  isCompatible: boolean;
  rejectionReason?: string;
  pickupDistanceMeters: number;
  destinationDistanceMeters: number;
  directionDifferenceDegrees: number;
  pickupRouteProgress: number;
  destinationRouteProgress: number;
  estimatedDetourMeters: number;
  compatibility: CompatibilityLevel;
  score: number;
}

export interface DiscoveryItemDto {
  tripId: string;
  driver: {
    id: string;
    name: string;
    image?: string;
  };
  vehicle: {
    id: string;
    registrationNumber: string;
    vehicleType: string;
    make?: string;
    model?: string;
  };
  origin: {
    name?: string;
    formattedAddress: string;
    coordinates: {
      type: "Point";
      coordinates: [number, number];
    };
  };
  destination: {
    name?: string;
    formattedAddress: string;
    coordinates: {
      type: "Point";
      coordinates: [number, number];
    };
  };
  routeSummary: {
    distanceMeters?: number;
    durationSeconds?: number;
  };
  match: {
    pickupDistanceMeters: number;
    destinationDistanceMeters: number;
    directionDifferenceDegrees: number;
    pickupRouteProgress: number;
    destinationRouteProgress: number;
    estimatedDetourMeters: number;
    compatibility: CompatibilityLevel;
    score: number;
  };
}

export interface DiscoveryPagination {
  limit: number;
  hasMore: boolean;
  nextCursor: string | null;
}

export interface DiscoveryResponse {
  discoverySessionId: string;
  items: DiscoveryItemDto[];
  pagination: DiscoveryPagination;
}

export interface DiscoverySearchRequest {
  origin: {
    latitude: number;
    longitude: number;
    name?: string;
    formattedAddress?: string;
  };
  destination: {
    latitude: number;
    longitude: number;
    name?: string;
    formattedAddress?: string;
  };
  options?: {
    maxPickupDistanceMeters?: number;
    maxDestinationDeviationMeters?: number;
    maxResults?: number;
    cursor?: string;
  };
}
