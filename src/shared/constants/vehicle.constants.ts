/**
 * Supported Vehicle Types for Isahara Mobility Platform.
 * Strictly limited to approved Phase 3 types. Arbitrary strings are forbidden.
 */
export enum VehicleType {
  AUTO = "AUTO",
  E_RICKSHAW = "E_RICKSHAW",
  CAB = "CAB",
  BUS = "BUS",
  CAR = "CAR",
  BIKE = "BIKE",
  OTHER = "OTHER",
}

export const VEHICLE_TYPES = {
  AUTO: VehicleType.AUTO,
  E_RICKSHAW: VehicleType.E_RICKSHAW,
  CAB: VehicleType.CAB,
  BUS: VehicleType.BUS,
  CAR: VehicleType.CAR,
  BIKE: VehicleType.BIKE,
  OTHER: VehicleType.OTHER,
} as const;

export const ALL_VEHICLE_TYPES: readonly VehicleType[] = Object.values(VehicleType);
