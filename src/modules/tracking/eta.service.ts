import { TrackingFreshness, TrackingETAInfo } from "./tracking.types";
import { env } from "../../config/env";

export interface ETAInput {
  remainingDistanceMeters: number;
  currentSpeedMps?: number | null;
  trackingFreshness: TrackingFreshness;
  isOffRoute?: boolean;
}

export class ETAService {
  /**
   * Deterministically computes local ETA estimate with explicit quality and confidence grading.
   * Protects against division-by-zero, negative distances, and unrealistic speeds.
   * Does NOT make external routing provider calls.
   */
  estimate(input: ETAInput): TrackingETAInfo {
    const {
      remainingDistanceMeters,
      currentSpeedMps,
      trackingFreshness,
      isOffRoute = false,
    } = input;

    // 1. Data reliability gate: un-fresh GPS invalidates ETA
    if (trackingFreshness === "UNAVAILABLE" || trackingFreshness === "STALE") {
      return { available: false };
    }

    // 2. Numerical safety on remaining distance
    if (
      typeof remainingDistanceMeters !== "number" ||
      !Number.isFinite(remainingDistanceMeters) ||
      Number.isNaN(remainingDistanceMeters) ||
      remainingDistanceMeters < 0
    ) {
      return { available: false };
    }

    // 3. Destination reached
    if (remainingDistanceMeters === 0) {
      return {
        available: true,
        seconds: 0,
        source: "LOCAL_ESTIMATE",
        confidence: "MEDIUM",
      };
    }

    // 4. Effective speed selection and bounds enforcement
    let effectiveSpeed = env.ETA_DEFAULT_SPEED_MPS;
    let confidence: "LOW" | "MEDIUM" = "LOW";

    if (
      typeof currentSpeedMps === "number" &&
      Number.isFinite(currentSpeedMps) &&
      !Number.isNaN(currentSpeedMps) &&
      currentSpeedMps >= env.ETA_MIN_SPEED_MPS
    ) {
      // Clamped operational driver speed
      effectiveSpeed = Math.min(
        env.ETA_MAX_SPEED_MPS,
        Math.max(env.ETA_MIN_SPEED_MPS, currentSpeedMps)
      );
      confidence = isOffRoute ? "LOW" : "MEDIUM";
    } else {
      // Stationary (speed = 0) or missing sensor telemetry: use conservative default speed
      effectiveSpeed = env.ETA_DEFAULT_SPEED_MPS;
      confidence = "LOW";
    }

    // Zero / negative speed guard (mathematically impossible after clamping, but defensive)
    if (effectiveSpeed <= 0 || !Number.isFinite(effectiveSpeed)) {
      return { available: false };
    }

    // 5. Calculate and clamp duration seconds (max 24 hours = 86400s)
    const rawSeconds = remainingDistanceMeters / effectiveSpeed;
    if (!Number.isFinite(rawSeconds) || Number.isNaN(rawSeconds)) {
      return { available: false };
    }

    const seconds = Math.min(86400, Math.max(0, Math.round(rawSeconds)));

    return {
      available: true,
      seconds,
      source: "LOCAL_ESTIMATE",
      confidence,
    };
  }
}

export const etaService = new ETAService();
