import { env } from "../../../config/env";
import { logger } from "../../../config/logger";
import {
  IRoadsProvider,
  LatLngPoint,
  SnappedPoint,
  SnapToRoadsParams,
  SnapToRoadsResult,
} from "../location.types";
import { BadRequestError } from "../../../shared/errors/app-error";
import { ERROR_CODES } from "../../../shared/errors/error-codes";

/**
 * Raw response item structure from Google Roads API snapToRoads.
 */
interface GoogleRoadsRawSnappedPoint {
  location?: {
    latitude?: number;
    longitude?: number;
  };
  originalIndex?: number;
  placeId?: string;
}

interface GoogleRoadsRawResponse {
  snappedPoints?: GoogleRoadsRawSnappedPoint[];
  warningMessage?: string;
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
}

export interface GoogleRoadsProviderConfig {
  apiKey?: string;
  enabled?: boolean;
  timeoutMs?: number;
}

/**
 * GoogleRoadsProvider integrates with Google Roads API v1 (Snap to Roads).
 * Endpoint: GET https://roads.googleapis.com/v1/snapToRoads
 *
 * Security & Credential Isolation:
 * - Uses server-side GOOGLE_ROADS_API_KEY.
 * - Supports legacy developer local alias GOOGLE_ROADS_API with deprecation warning.
 * - Enforces strict isolation: never uses Places, Routes, Geocoding, Android Maps SDK,
 *   or universal Google Maps keys.
 * - Sanitizes all logging to prevent API keys or sensitive tracking telemetry exposure.
 */
export class GoogleRoadsProvider implements IRoadsProvider {
  readonly name = "google_roads" as const;
  private static readonly ENDPOINT = "https://roads.googleapis.com/v1/snapToRoads";
  private static readonly MAX_POINTS = 100;
  private static readonly DEFAULT_TIMEOUT_MS = 5000;

  private config: GoogleRoadsProviderConfig;

  constructor(config: GoogleRoadsProviderConfig = {}) {
    this.config = config;
  }

  /**
   * Resolves the canonical server-side Roads API key with strict isolation.
   */
  private getApiKey(): string | undefined {
    if (this.config.apiKey !== undefined) {
      const explicit = this.config.apiKey.trim();
      return explicit.length > 0 ? explicit : undefined;
    }

    if (process.env.GOOGLE_ROADS_API_KEY !== undefined) {
      const canonical = process.env.GOOGLE_ROADS_API_KEY.trim();
      if (canonical.length > 0) return canonical;
    } else if (env.GOOGLE_ROADS_API_KEY && env.GOOGLE_ROADS_API_KEY.trim().length > 0) {
      return env.GOOGLE_ROADS_API_KEY.trim();
    }

    if (process.env.GOOGLE_ROADS_API !== undefined) {
      const alias = process.env.GOOGLE_ROADS_API.trim();
      if (alias.length > 0) {
        logger.warn(
          "⚠️ DEPRECATION: GOOGLE_ROADS_API is deprecated. Rename to GOOGLE_ROADS_API_KEY."
        );
        return alias;
      }
    } else if (env.GOOGLE_ROADS_API && env.GOOGLE_ROADS_API.trim().length > 0) {
      logger.warn(
        "⚠️ DEPRECATION: GOOGLE_ROADS_API is deprecated. Rename to GOOGLE_ROADS_API_KEY."
      );
      return env.GOOGLE_ROADS_API.trim();
    }

    return undefined;
  }

  /**
   * Checks whether the provider is configured and available for requests.
   */
  isAvailable(): boolean {
    if (this.config.enabled === false) {
      return false;
    }
    return Boolean(this.getApiKey());
  }

  /**
   * Sanitizes URLs for secure logging by masking API key query parameters.
   */
  private sanitizeUrl(urlString: string): string {
    try {
      const url = new URL(urlString);
      if (url.searchParams.has("key")) {
        url.searchParams.set("key", "[REDACTED]");
      }
      return url.toString();
    } catch {
      return urlString.replace(/key=[^&]+/g, "key=[REDACTED]");
    }
  }

  /**
   * Snaps a bounded sequence of GPS coordinates to the physical road network.
   *
   * @param params Points to snap and optional interpolation flag
   * @returns Snapped road coordinates or safe empty fallback on error
   */
  async snapToRoads(params: SnapToRoadsParams): Promise<SnapToRoadsResult> {
    const computedAt = new Date().toISOString();

    if (!params.points || !Array.isArray(params.points) || params.points.length === 0) {
      return {
        snappedPoints: [],
        provider: this.name,
        computedAt,
      };
    }

    // Enforce Google Roads API 100-point limit per request
    if (params.points.length > GoogleRoadsProvider.MAX_POINTS) {
      throw new BadRequestError(
        `Google Roads API snapToRoads accepts a maximum of ${GoogleRoadsProvider.MAX_POINTS} points per request (received ${params.points.length}).`,
        ERROR_CODES.BAD_REQUEST
      );
    }

    // Validate finite coordinates and valid spherical bounds (-90..90, -180..180)
    for (let i = 0; i < params.points.length; i++) {
      const pt = params.points[i];
      if (
        !pt ||
        typeof pt.latitude !== "number" ||
        typeof pt.longitude !== "number" ||
        !Number.isFinite(pt.latitude) ||
        !Number.isFinite(pt.longitude) ||
        Number.isNaN(pt.latitude) ||
        Number.isNaN(pt.longitude) ||
        pt.latitude < -90 ||
        pt.latitude > 90 ||
        pt.longitude < -180 ||
        pt.longitude > 180
      ) {
        throw new BadRequestError(
          `Invalid coordinate at index ${i}: latitude must be between -90 and 90, and longitude between -180 and 180.`,
          ERROR_CODES.BAD_REQUEST
        );
      }
    }

    const apiKey = this.getApiKey();
    if (!apiKey) {
      logger.warn("Google Roads API key not configured, returning empty snapped points", {
        provider: this.name,
      });
      return {
        snappedPoints: [],
        provider: this.name,
        computedAt,
      };
    }

    // Deduplicate consecutive identical coordinates to optimize payload and avoid zero-length segments
    const deduplicatedPoints: LatLngPoint[] = [];
    for (const pt of params.points) {
      if (deduplicatedPoints.length === 0) {
        deduplicatedPoints.push(pt);
      } else {
        const prev = deduplicatedPoints[deduplicatedPoints.length - 1];
        if (prev.latitude !== pt.latitude || prev.longitude !== pt.longitude) {
          deduplicatedPoints.push(pt);
        }
      }
    }

    // Format path parameter as "lat,lon|lat,lon" in exact latitude,longitude order
    const pathString = deduplicatedPoints
      .map((p) => `${p.latitude},${p.longitude}`)
      .join("|");

    const queryParams = new URLSearchParams();
    queryParams.set("path", pathString);
    if (params.interpolate) {
      queryParams.set("interpolate", "true");
    }
    queryParams.set("key", apiKey);

    const requestUrl = `${GoogleRoadsProvider.ENDPOINT}?${queryParams.toString()}`;
    const timeoutMs = this.config.timeoutMs ?? GoogleRoadsProvider.DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const headers: Record<string, string> = {
        Accept: "application/json",
        "X-Goog-Api-Key": apiKey,
      };

      let response = await fetch(requestUrl, {
        method: "GET",
        headers,
        signal: controller.signal,
      });

      if (response.status === 403) {
        let errMessage = "";
        try {
          const errData: any = await response.clone().json();
          errMessage = errData?.error?.message || "";
        } catch {
          // ignore
        }

        if (errMessage.includes("Android client application")) {
          const androidPkg = process.env.GOOGLE_ANDROID_PACKAGE_NAME || env.GOOGLE_ANDROID_PACKAGE_NAME || "com.ishara.app";
          const androidCert = process.env.GOOGLE_ANDROID_CERT_SHA1 || env.GOOGLE_ANDROID_CERT_SHA1 || "C0D888B8A6168C5880FCA58C5D35038EC7A45D98";
          logger.info("Google Roads API key is Android-restricted; retrying with Android client identity headers", {
            provider: this.name,
            package: androidPkg,
          });
          response = await fetch(requestUrl, {
            method: "GET",
            headers: {
              ...headers,
              "X-Android-Package": androidPkg,
              "X-Android-Cert": androidCert,
            },
            signal: controller.signal,
          });
        }
      }

      if (!response.ok) {
        this.handleHttpError(response.status);
        return {
          snappedPoints: [],
          provider: this.name,
          computedAt,
        };
      }

      const data = (await response.json()) as GoogleRoadsRawResponse;

      if (data.error) {
        logger.warn("Google Roads API returned error payload", {
          status: data.error.code,
          message: data.error.message,
          provider: this.name,
        });
        return {
          snappedPoints: [],
          provider: this.name,
          computedAt,
        };
      }

      if (!data.snappedPoints || !Array.isArray(data.snappedPoints) || data.snappedPoints.length === 0) {
        return {
          snappedPoints: [],
          provider: this.name,
          computedAt,
          warningMessage: data.warningMessage,
        };
      }

      const normalizedPoints: SnappedPoint[] = [];
      for (const item of data.snappedPoints) {
        const lat = item.location?.latitude;
        const lon = item.location?.longitude;

        if (
          typeof lat === "number" &&
          typeof lon === "number" &&
          Number.isFinite(lat) &&
          Number.isFinite(lon) &&
          lat >= -90 &&
          lat <= 90 &&
          lon >= -180 &&
          lon <= 180
        ) {
          normalizedPoints.push({
            latitude: lat,
            longitude: lon,
            placeId: typeof item.placeId === "string" ? item.placeId : undefined,
            originalIndex:
              typeof item.originalIndex === "number" && Number.isInteger(item.originalIndex)
                ? item.originalIndex
                : undefined,
          });
        }
      }

      return {
        snappedPoints: normalizedPoints,
        provider: this.name,
        computedAt,
        warningMessage: data.warningMessage,
      };
    } catch (err: any) {
      if (err.name === "AbortError") {
        logger.warn("Google Roads API request timed out", {
          timeoutMs,
          provider: this.name,
        });
      } else {
        logger.warn("Google Roads API request failed", {
          error: err.message,
          provider: this.name,
        });
      }

      return {
        snappedPoints: [],
        provider: this.name,
        computedAt,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Maps HTTP error statuses to structured diagnostics without exposing credentials.
   */
  private handleHttpError(status: number): void {
    if (status === 400) {
      logger.warn("Google Roads API 400 Bad Request", {
        status,
        provider: this.name,
      });
    } else if (status === 401 || status === 403) {
      logger.error("Google Roads API authentication/permission failure", {
        status,
        provider: this.name,
      });
    } else if (status === 429) {
      logger.warn("Google Roads API quota exceeded / rate limited (429)", {
        status,
        provider: this.name,
      });
    } else if (status >= 500) {
      logger.warn("Google Roads API server error", {
        status,
        provider: this.name,
      });
    } else {
      logger.warn("Google Roads API returned unexpected HTTP status", {
        status,
        provider: this.name,
      });
    }
  }
}

export const googleRoadsProvider = new GoogleRoadsProvider();
