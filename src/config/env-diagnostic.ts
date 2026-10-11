import {
  parseClientUrls,
  isRoutesConfigured,
  isPlacesConfigured,
  isGeocodingConfigured,
  isRoadsConfigured,
  isRoadsSnapEnabled,
} from "./env";

export interface EnvAuditItem {
  variable: string;
  isSet: boolean;
  isValidFormat: boolean;
  isRequiredInProduction: boolean;
  feature: string;
  featureEnabled: boolean;
  notes?: string;
}

/**
 * Performs a zero-exposure security audit on the environment variables.
 * Inspects variable presence, format validity, requirement in production,
 * and whether the associated feature is active.
 *
 * CRITICAL SECURITY GUARANTEE: NEVER logs, stores, or prints actual secret values.
 */
export function auditEnvironmentVariables(
  envInput: Record<string, string | undefined> = process.env
): EnvAuditItem[] {
  const isSet = (key: string): boolean => {
    const val = envInput[key];
    return typeof val === "string" && val.trim().length > 0;
  };

  const nodeEnv = envInput.NODE_ENV || "development";
  const isProd = nodeEnv === "production";

  const routingProvider = envInput.ROUTING_PROVIDER || "google_routes";
  const locationPrimary = envInput.LOCATION_PRIMARY_PROVIDER || "google_maps";
  const locationFallback = envInput.LOCATION_FALLBACK_PROVIDER || "serpapi";
  const speechPrimary = envInput.SPEECH_PRIMARY_PROVIDER || "whisper";
  const speechFallback = envInput.SPEECH_FALLBACK_PROVIDER || "openai";
  const intentProvider = envInput.INTENT_PROVIDER || "deterministic";

  const items: EnvAuditItem[] = [];

  // 1. Core Server Runtime
  items.push({
    variable: "NODE_ENV",
    isSet: isSet("NODE_ENV"),
    isValidFormat: ["development", "production", "test"].includes(nodeEnv),
    isRequiredInProduction: true,
    feature: "Core Node.js Runtime",
    featureEnabled: true,
  });

  items.push({
    variable: "PORT",
    isSet: isSet("PORT"),
    isValidFormat: isSet("PORT") ? !Number.isNaN(Number(envInput.PORT)) : true,
    isRequiredInProduction: false,
    feature: "HTTP Listener Port",
    featureEnabled: true,
    notes: "Defaults to 5000 if omitted",
  });

  items.push({
    variable: "MONGODB_URI",
    isSet: isSet("MONGODB_URI"),
    isValidFormat: isSet("MONGODB_URI") && (
      envInput.MONGODB_URI!.startsWith("mongodb://") ||
      envInput.MONGODB_URI!.startsWith("mongodb+srv://")
    ),
    isRequiredInProduction: true,
    feature: "MongoDB Database Persistence",
    featureEnabled: true,
  });

  items.push({
    variable: "CLIENT_URL",
    isSet: isSet("CLIENT_URL"),
    isValidFormat: parseClientUrls(envInput.CLIENT_URL).length > 0,
    isRequiredInProduction: true,
    feature: "CORS Allowlist & Web Dashboard",
    featureEnabled: true,
    notes: "Supports single URL or multiple delimited by || or comma",
  });

  items.push({
    variable: "ADMIN_SECRET_KEY",
    isSet: isSet("ADMIN_SECRET_KEY"),
    isValidFormat: isSet("ADMIN_SECRET_KEY") && (!isProd || envInput.ADMIN_SECRET_KEY !== "replace_with_secure_secret"),
    isRequiredInProduction: true,
    feature: "Platform Administrative API Guard",
    featureEnabled: true,
  });

  // 2. Authentication & Better Auth
  items.push({
    variable: "BETTER_AUTH_SECRET",
    isSet: isSet("BETTER_AUTH_SECRET"),
    isValidFormat: isSet("BETTER_AUTH_SECRET") && envInput.BETTER_AUTH_SECRET!.trim().length >= 16 && (!isProd || envInput.BETTER_AUTH_SECRET !== "isahara-default-dev-secret-32-chars-long!"),
    isRequiredInProduction: true,
    feature: "Better Auth User Authentication",
    featureEnabled: true,
  });

  items.push({
    variable: "BETTER_AUTH_URL",
    isSet: isSet("BETTER_AUTH_URL"),
    isValidFormat: isSet("BETTER_AUTH_URL") && (
      !isProd || (
        envInput.BETTER_AUTH_URL!.startsWith("https://") &&
        !envInput.BETTER_AUTH_URL!.includes("localhost") &&
        !envInput.BETTER_AUTH_URL!.includes("127.0.0.1")
      )
    ),
    isRequiredInProduction: true,
    feature: "Better Auth Base URL",
    featureEnabled: true,
  });

  items.push({
    variable: "GOOGLE_ANDROID_CLIENT_ID",
    isSet: isSet("GOOGLE_ANDROID_CLIENT_ID"),
    isValidFormat: isSet("GOOGLE_ANDROID_CLIENT_ID") && envInput.GOOGLE_ANDROID_CLIENT_ID!.includes(".apps.googleusercontent.com"),
    isRequiredInProduction: true,
    feature: "Android Google Sign-In Identity",
    featureEnabled: true,
  });

  items.push({
    variable: "GOOGLE_WEB_CLIENT_ID",
    isSet: isSet("GOOGLE_WEB_CLIENT_ID") || isSet("GOOGLE_CLIENT_ID"),
    isValidFormat: (isSet("GOOGLE_WEB_CLIENT_ID") || isSet("GOOGLE_CLIENT_ID")),
    isRequiredInProduction: true,
    feature: "Web Google OAuth Authentication",
    featureEnabled: true,
  });

  items.push({
    variable: "GOOGLE_CLIENT_SECRET",
    isSet: isSet("GOOGLE_CLIENT_SECRET"),
    isValidFormat: isSet("GOOGLE_CLIENT_SECRET"),
    isRequiredInProduction: true,
    feature: "Web Google OAuth Server Secret",
    featureEnabled: true,
  });

  // 3. Email Delivery (OTP)
  items.push({
    variable: "RESEND_API_KEY",
    isSet: isSet("RESEND_API_KEY"),
    isValidFormat: isSet("RESEND_API_KEY") && envInput.RESEND_API_KEY!.startsWith("re_"),
    isRequiredInProduction: true,
    feature: "Resend Email OTP Delivery",
    featureEnabled: true,
  });

  items.push({
    variable: "EMAIL_FROM",
    isSet: isSet("EMAIL_FROM"),
    isValidFormat: isSet("EMAIL_FROM") && envInput.EMAIL_FROM!.includes("@"),
    isRequiredInProduction: true,
    feature: "Resend Sender Email Address",
    featureEnabled: true,
  });

  // 4. Google Maps Platform — Server-Side Credentials
  const routesConfigured = isSet("GOOGLE_ROUTES_API_KEY") || isSet("GOOGLE_ROUTES_API") || isSet("GOOGLE_MAPS_API_KEY");
  items.push({
    variable: "GOOGLE_ROUTES_API_KEY",
    isSet: isSet("GOOGLE_ROUTES_API_KEY"),
    isValidFormat: isSet("GOOGLE_ROUTES_API_KEY"),
    isRequiredInProduction: routingProvider === "google_routes",
    feature: "Google Routes API v2 Road Routing",
    featureEnabled: routingProvider === "google_routes",
    notes: !isSet("GOOGLE_ROUTES_API_KEY") && routesConfigured ? "Resolved via fallback alias" : undefined,
  });

  const placesConfigured = isSet("GOOGLE_PLACES_API_KEY") || isSet("GOOGLE_PLACES_API");
  items.push({
    variable: "GOOGLE_PLACES_API_KEY",
    isSet: isSet("GOOGLE_PLACES_API_KEY"),
    isValidFormat: isSet("GOOGLE_PLACES_API_KEY"),
    isRequiredInProduction: locationPrimary === "google_maps" || locationFallback === "google_maps",
    feature: "Google Places API (New) Location Search",
    featureEnabled: locationPrimary === "google_maps" || locationFallback === "google_maps",
    notes: !isSet("GOOGLE_PLACES_API_KEY") && placesConfigured ? "Resolved via fallback alias" : undefined,
  });

  const geocodingConfigured = isSet("GOOGLE_GEOCODING_API_KEY") || isSet("GOOGLE_GEOCODING_API");
  items.push({
    variable: "GOOGLE_GEOCODING_API_KEY",
    isSet: isSet("GOOGLE_GEOCODING_API_KEY"),
    isValidFormat: isSet("GOOGLE_GEOCODING_API_KEY"),
    isRequiredInProduction: false,
    feature: "Google Geocoding & Reverse Geocoding",
    featureEnabled: geocodingConfigured,
    notes: "Optional address lookup provider",
  });

  const roadsConfigured = isSet("GOOGLE_ROADS_API_KEY") || isSet("GOOGLE_ROADS_API");
  const roadsSnapEnabled = (envInput.GOOGLE_ROADS_SNAP_ENABLED === "true" || envInput.GOOGLE_ROADS_SNAP_ENABLED === "1") && roadsConfigured;
  items.push({
    variable: "GOOGLE_ROADS_API_KEY",
    isSet: isSet("GOOGLE_ROADS_API_KEY"),
    isValidFormat: isSet("GOOGLE_ROADS_API_KEY"),
    isRequiredInProduction: false,
    feature: "Google Roads API Snap to Roads",
    featureEnabled: roadsSnapEnabled,
    notes: "Feature flag GOOGLE_ROADS_SNAP_ENABLED controls activation",
  });

  items.push({
    variable: "GOOGLE_ROADS_SNAP_ENABLED",
    isSet: isSet("GOOGLE_ROADS_SNAP_ENABLED"),
    isValidFormat: true,
    isRequiredInProduction: false,
    feature: "Snap to Roads Feature Flag",
    featureEnabled: roadsSnapEnabled,
    notes: "Default: false (raw GPS telemetry preserved)",
  });

  // 5. Speech & Voice-First Providers (Optional)
  items.push({
    variable: "WHISPER_BASE_URL",
    isSet: isSet("WHISPER_BASE_URL"),
    isValidFormat: isSet("WHISPER_BASE_URL") && (
      envInput.WHISPER_BASE_URL!.startsWith("http://") ||
      envInput.WHISPER_BASE_URL!.startsWith("https://")
    ),
    isRequiredInProduction: false,
    feature: "Self-Hosted Whisper Speech-to-Text",
    featureEnabled: speechPrimary === "whisper" || speechFallback === "whisper",
    notes: "Optional self-hosted inference endpoint",
  });

  items.push({
    variable: "OPENAI_API_KEY",
    isSet: isSet("OPENAI_API_KEY"),
    isValidFormat: isSet("OPENAI_API_KEY"),
    isRequiredInProduction: false,
    feature: "OpenAI Whisper STT & Intent Extraction",
    featureEnabled: speechPrimary === "openai" || speechFallback === "openai" || intentProvider === "openai",
    notes: "Optional cloud speech fallback",
  });

  items.push({
    variable: "GOOGLE_STT_API_KEY",
    isSet: isSet("GOOGLE_STT_API_KEY"),
    isValidFormat: isSet("GOOGLE_STT_API_KEY"),
    isRequiredInProduction: false,
    feature: "Google Cloud Speech-to-Text",
    featureEnabled: speechPrimary === "google" || speechFallback === "google",
    notes: "Optional cloud speech provider",
  });

  return items;
}
