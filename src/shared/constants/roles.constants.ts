/**
 * Core Application Roles for Isahara Mobility Platform.
 * 
 * Rules:
 * - ONLY TWO application roles: USER and DRIVER_CONDUCTOR.
 * - NO separate DRIVER role and CONDUCTOR role.
 * - NO college-admin role in the core product.
 */
export enum UserRole {
  USER = "USER",
  DRIVER_CONDUCTOR = "DRIVER_CONDUCTOR",
}

export const ROLES = {
  USER: UserRole.USER,
  DRIVER_CONDUCTOR: UserRole.DRIVER_CONDUCTOR,
} as const;

export type Role = UserRole;

export const ALL_ROLES: readonly Role[] = Object.values(UserRole);
