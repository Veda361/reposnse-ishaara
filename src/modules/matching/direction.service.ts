import { MATCHING_CONSTANTS } from "./matching.constants";

export class DirectionService {
  /**
   * Computes the forward initial bearing from start [lng, lat] to end [lng, lat] in degrees [0, 360).
   */
  calculateBearing(
    start: [number, number], // [lng, lat]
    end: [number, number] // [lng, lat]
  ): number {
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const toDeg = (rad: number) => (rad * 180) / Math.PI;

    const lat1 = toRad(start[1]);
    const lat2 = toRad(end[1]);
    const dLon = toRad(end[0] - start[0]);

    const y = Math.sin(dLon) * Math.cos(lat2);
    const x =
      Math.cos(lat1) * Math.sin(lat2) -
      Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);

    const bearing = toDeg(Math.atan2(y, x));
    return (bearing + 360) % 360;
  }

  /**
   * Computes the minimum angular difference between two bearings in degrees [0, 180],
   * taking into account 360-degree circular wraparound.
   */
  angularDifference(bearing1: number, bearing2: number): number {
    const diff = Math.abs(bearing1 - bearing2) % 360;
    return diff > 180 ? 360 - diff : diff;
  }

  /**
   * Determines if two directions are compatible within a threshold (default 45 degrees).
   */
  isDirectionCompatible(
    bearing1: number,
    bearing2: number,
    thresholdDegrees: number = MATCHING_CONSTANTS.SAME_DIRECTION_THRESHOLD_DEGREES
  ): boolean {
    return this.angularDifference(bearing1, bearing2) <= thresholdDegrees;
  }

  /**
   * Determines if two directions are opposing within a threshold (default >= 135 degrees).
   */
  isOppositeDirection(
    bearing1: number,
    bearing2: number,
    thresholdDegrees: number = MATCHING_CONSTANTS.OPPOSITE_DIRECTION_THRESHOLD_DEGREES
  ): boolean {
    return this.angularDifference(bearing1, bearing2) >= thresholdDegrees;
  }
}

export const directionService = new DirectionService();
