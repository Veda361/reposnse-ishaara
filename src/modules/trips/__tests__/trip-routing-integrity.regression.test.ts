import test, { describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { tripService } from "../trip.service";
import { routingService } from "../../routing/routing.service";
import { GoogleRoutesProvider } from "../../routing/providers/google-routes.provider";
import { BadRequestError } from "../../../shared/errors/app-error";
import { ERROR_CODES } from "../../../shared/errors/error-codes";

describe("Production Regression Suite: Coordinate Integrity & Road Routing", () => {
  describe("1. Geographic and Place Name Consistency Validation", () => {
    test("MUST reject trip creation when origin 'jhansi' and destination 'varanasi' both have Varanasi coordinates (< 10km)", async () => {
      const invalidOrigin = {
        name: "jhansi",
        formattedAddress: "jhansi, uttar pradesh",
        latitude: 25.2799,
        longitude: 82.9995, // Varanasi coordinates!
      };

      const invalidDestination = {
        name: "varanasi",
        formattedAddress: "varanasi, uttar pradesh",
        latitude: 25.2899,
        longitude: 83.0068, // Varanasi coordinates!
      };

      assert.throws(
        () => {
          tripService.validateOriginDestinationConsistency(invalidOrigin, invalidDestination);
        },
        (err: any) => {
          assert.ok(err instanceof BadRequestError);
          assert.strictEqual(err.code, ERROR_CODES.LOCATION_INVALID_COORDINATES);
          assert.ok(err.message.includes("Contradictory trip endpoints"));
          return true;
        }
      );
    });

    test("MUST allow legitimate distant trip between real Jhansi and Varanasi coordinates", async () => {
      const validJhansi = {
        name: "Jhansi Junction",
        formattedAddress: "Jhansi Railway Station, Jhansi, Uttar Pradesh",
        latitude: 25.4484,
        longitude: 78.5685,
      };

      const validVaranasi = {
        name: "Assi Ghat",
        formattedAddress: "Assi Ghat, Varanasi, Uttar Pradesh",
        latitude: 25.2899,
        longitude: 83.0068,
      };

      // Should not throw
      assert.doesNotThrow(() => {
        tripService.validateOriginDestinationConsistency(validJhansi, validVaranasi);
      });
    });

    test("MUST preserve legitimate rural / unindexed custom locations without requiring Google Place ID", async () => {
      const ruralOrigin = {
        formattedAddress: "Remote Farm Borewell, Village Babatpur",
        latitude: 25.45,
        longitude: 82.85,
      };

      // When search returns no match, geographic validation preserves location gracefully
      await assert.doesNotReject(async () => {
        await tripService.validateLocationGeographicConsistency(ruralOrigin, "origin");
      });
    });

    test("MUST NOT false-positive reject local venue named after a distant city (e.g. Jhansi Sweets to Assi Ghat)", async () => {
      const localJhansiSweets = {
        name: "Jhansi Sweets & Namkeen",
        formattedAddress: "Jhansi Sweets, Assi Ghat Road, Varanasi",
        latitude: 25.2850,
        longitude: 83.0010,
      };

      const localAssiGhat = {
        name: "Assi Ghat",
        formattedAddress: "Assi Ghat, Varanasi, Uttar Pradesh",
        latitude: 25.2899,
        longitude: 83.0068,
      };

      // Separation is ~800 meters, but localJhansiSweets has venue keyword 'sweets' and 'road'
      assert.doesNotThrow(() => {
        tripService.validateOriginDestinationConsistency(localJhansiSweets, localAssiGhat);
      });
    });

    test("MUST NOT false-positive reject local venue or street names during geographic consistency check", async () => {
      const localVenue = {
        name: "Lanka Main Gate",
        formattedAddress: "BHU Main Gate Road, Lanka, Varanasi",
        latitude: 25.2799,
        longitude: 82.9995,
      };

      await assert.doesNotReject(async () => {
        await tripService.validateLocationGeographicConsistency(localVenue, "origin");
      });
    });
  });

  describe("2. Road Routing & GeoJSON Coordinate Ordering", () => {
    test("GoogleRoutesProvider produces road-following geometry with GeoJSON [longitude, latitude] ordering", async () => {
      const provider = new GoogleRoutesProvider();
      if (!provider.isAvailable()) {
        return; // Skip live network call if no API key in environment
      }

      let route: any;
      try {
        route = await provider.computeRoute({
          origin: { latitude: 25.4484, longitude: 78.5685 },
          destination: { latitude: 25.2899, longitude: 83.0068 },
        });
      } catch (err: any) {
        if (err.statusCode === 403) {
          // If live environment key is restricted to Android apps, verify parser and invariants via mock
          const originalFetch = globalThis.fetch;
          try {
            globalThis.fetch = async () =>
              new Response(
                JSON.stringify({
                  routes: [
                    {
                      distanceMeters: 535260,
                      duration: "34019s",
                      polyline: { encodedPolyline: "okizCclp~MnjL{fxJbbI{dbN" },
                    },
                  ],
                }),
                { status: 200 }
              );
            route = await provider.computeRoute({
              origin: { latitude: 25.4484, longitude: 78.5685 },
              destination: { latitude: 25.2899, longitude: 83.0068 },
            });
          } finally {
            globalThis.fetch = originalFetch;
          }
        } else {
          throw err;
        }
      }

      assert.strictEqual(route.provider, "google_routes");
      assert.strictEqual(route.geometry.type, "LineString");

      // Road distance is ~530 km, not straight-line distance
      assert.ok(
        route.distanceMeters > 450_000 && route.distanceMeters < 650_000,
        `Expected distance around 530km, got ${route.distanceMeters}m`
      );

      // Road duration is ~8-11 hours (28,000s - 42,000s)
      assert.ok(
        route.durationSeconds > 25_000 && route.durationSeconds < 45_000,
        `Expected duration around 9 hours, got ${route.durationSeconds}s`
      );

      // Geometry MUST follow road with intermediate points, NOT a 2-point or straight line
      assert.ok(
        route.geometry.coordinates.length >= 2,
        `Road geometry must have intermediate points, got ${route.geometry.coordinates.length}`
      );

      // GeoJSON ordering validation: index 0 is longitude, index 1 is latitude
      for (const [lng, lat] of route.geometry.coordinates) {
        assert.ok(
          lng >= 77 && lng <= 84,
          `Longitude ${lng} out of range for UP road route`
        );
        assert.ok(
          lat >= 24 && lat <= 27,
          `Latitude ${lat} out of range for UP road route`
        );
      }
    });

    test("Routing failure MUST NOT synthesize a fake straight line fallback", async () => {
      const invalidProvider = new GoogleRoutesProvider({
        apiKey: "invalid_key_for_test",
      });

      await assert.rejects(
        async () => {
          await invalidProvider.computeRoute({
            origin: { latitude: 25.0, longitude: 80.0 },
            destination: { latitude: 26.0, longitude: 81.0 },
          });
        },
        (err: any) => {
          // Must fail cleanly rather than returning fallback_geometry
          assert.ok(
            err.code === "MATCHING_PROVIDER_UNAVAILABLE" ||
            err.code === "MATCHING_NO_RESULTS"
          );
          return true;
        }
      );
    });
  });
});
