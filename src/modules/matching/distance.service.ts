export interface PointToSegmentResult {
  distanceMeters: number;
  nearestPoint: [number, number]; // [longitude, latitude]
  t: number; // Normalized projection ratio along this segment [0.0, 1.0]
  segmentLengthMeters: number;
}

export interface PointToPolylineResult {
  distanceMeters: number;
  nearestPoint: [number, number]; // [longitude, latitude]
  nearestSegmentIndex: number;
  distanceAlongPolylineMeters: number;
  totalPolylineLengthMeters: number;
}

export class DistanceService {
  /**
   * Computes great-circle distance between two [longitude, latitude] coordinates in meters using Haversine.
   */
  distanceBetweenCoordinates(
    coord1: [number, number],
    coord2: [number, number]
  ): number {
    const lon1 = coord1[0];
    const lat1 = coord1[1];
    const lon2 = coord2[0];
    const lat2 = coord2[1];

    if (lon1 === lon2 && lat1 === lat2) return 0;

    const R = 6371e3; // Earth radius in meters
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const phi1 = toRad(lat1);
    const phi2 = toRad(lat2);
    const deltaPhi = toRad(lat2 - lat1);
    const deltaLambda = toRad(lon2 - lon1);

    const a =
      Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
      Math.cos(phi1) *
        Math.cos(phi2) *
        Math.sin(deltaLambda / 2) *
        Math.sin(deltaLambda / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  /**
   * Computes total distance of a polyline in meters.
   */
  calculatePolylineLengthMeters(coordinates: Array<[number, number]>): number {
    if (coordinates.length < 2) return 0;
    let total = 0;
    for (let i = 0; i < coordinates.length - 1; i++) {
      total += this.distanceBetweenCoordinates(coordinates[i], coordinates[i + 1]);
    }
    return total;
  }

  /**
   * Computes shortest distance from a point to a 2D line segment using local equirectangular projection.
   */
  pointToSegmentDistance(
    point: [number, number], // [lng, lat]
    segStart: [number, number], // [lng, lat]
    segEnd: [number, number] // [lng, lat]
  ): PointToSegmentResult {
    const segLength = this.distanceBetweenCoordinates(segStart, segEnd);
    if (segLength === 0) {
      return {
        distanceMeters: this.distanceBetweenCoordinates(point, segStart),
        nearestPoint: [segStart[0], segStart[1]],
        t: 0,
        segmentLengthMeters: 0,
      };
    }

    // Equirectangular local Cartesian projection
    const midLat = ((segStart[1] + segEnd[1]) / 2) * (Math.PI / 180);
    const cosLat = Math.cos(midLat);

    // Coordinate conversion in degrees (scaled by cosLat for longitude)
    const dx = (segEnd[0] - segStart[0]) * cosLat;
    const dy = segEnd[1] - segStart[1];

    const px = (point[0] - segStart[0]) * cosLat;
    const py = point[1] - segStart[1];

    // Projection factor t
    const segNormSq = dx * dx + dy * dy;
    let t = segNormSq > 0 ? (px * dx + py * dy) / segNormSq : 0;
    t = Math.max(0, Math.min(1, t));

    // Nearest point in spherical coordinates
    const nearestLng = segStart[0] + t * (segEnd[0] - segStart[0]);
    const nearestLat = segStart[1] + t * (segEnd[1] - segStart[1]);
    const nearestPoint: [number, number] = [nearestLng, nearestLat];

    const distanceMeters = this.distanceBetweenCoordinates(point, nearestPoint);

    return {
      distanceMeters,
      nearestPoint,
      t,
      segmentLengthMeters: segLength,
    };
  }

  /**
   * Projects a point onto a multi-segment polyline (LineString) and calculates:
   * - minimum cross-track distance to polyline
   * - nearest coordinate on the polyline
   * - cumulative distance along the polyline up to the projection point
   * - total length of the polyline
   */
  pointToPolylineDistance(
    point: [number, number],
    coordinates: Array<[number, number]>
  ): PointToPolylineResult {
    if (coordinates.length === 0) {
      return {
        distanceMeters: 0,
        nearestPoint: [point[0], point[1]],
        nearestSegmentIndex: 0,
        distanceAlongPolylineMeters: 0,
        totalPolylineLengthMeters: 0,
      };
    }

    if (coordinates.length === 1) {
      const d = this.distanceBetweenCoordinates(point, coordinates[0]);
      return {
        distanceMeters: d,
        nearestPoint: [coordinates[0][0], coordinates[0][1]],
        nearestSegmentIndex: 0,
        distanceAlongPolylineMeters: 0,
        totalPolylineLengthMeters: 0,
      };
    }

    let minDistance = Infinity;
    let bestNearestPoint: [number, number] = [coordinates[0][0], coordinates[0][1]];
    let bestSegmentIndex = 0;
    let distanceToBestSegmentStart = 0;
    let bestSegmentT = 0;

    let cumulativeDistance = 0;

    for (let i = 0; i < coordinates.length - 1; i++) {
      const segStart = coordinates[i];
      const segEnd = coordinates[i + 1];
      const segResult = this.pointToSegmentDistance(point, segStart, segEnd);

      if (segResult.distanceMeters < minDistance) {
        minDistance = segResult.distanceMeters;
        bestNearestPoint = segResult.nearestPoint;
        bestSegmentIndex = i;
        bestSegmentT = segResult.t;
        distanceToBestSegmentStart = cumulativeDistance;
      }

      cumulativeDistance += segResult.segmentLengthMeters;
    }

    const bestSegmentLength = this.distanceBetweenCoordinates(
      coordinates[bestSegmentIndex],
      coordinates[bestSegmentIndex + 1]
    );

    const distanceAlongPolylineMeters =
      distanceToBestSegmentStart + bestSegmentT * bestSegmentLength;

    return {
      distanceMeters: minDistance,
      nearestPoint: bestNearestPoint,
      nearestSegmentIndex: bestSegmentIndex,
      distanceAlongPolylineMeters,
      totalPolylineLengthMeters: cumulativeDistance,
    };
  }
}

export const distanceService = new DistanceService();
