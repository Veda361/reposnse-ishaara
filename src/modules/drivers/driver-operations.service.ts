import { Types } from "mongoose";
import { DriverProfileModel, maskLicenseNumber } from "./driver.model";
import {
  DriverStatus,
  DriverOperationalContextResponse,
} from "./driver.types";
import { VehicleModel, toCleanVehicleResponse } from "../vehicles/vehicle.model";
import { TripModel, toCleanTripResponse } from "../trips/trip.model";
import { TripStatus } from "../trips/trip.types";
import { RideModel, toRideResponse } from "../rides/ride.model";
import { RideStatus } from "../rides/ride.constants";
import { NotFoundError } from "../../shared/errors/app-error";
import { ERROR_CODES } from "../../shared/errors/error-codes";

/**
 * Calculates start and end of day in a specific IANA timezone.
 * Defaults to "Asia/Kolkata" (IST, UTC+05:30).
 */
export function getTimezoneDayBounds(
  referenceDate: Date = new Date(),
  timezone: string = "Asia/Kolkata"
): { startOfDay: Date; endOfDay: Date; dateString: string } {
  let targetTz = timezone;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: targetTz });
  } catch {
    targetTz = "Asia/Kolkata";
  }

  // Extract YYYY-MM-DD in the target timezone
  const dateParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: targetTz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(referenceDate); // Format: "YYYY-MM-DD"

  // Extract the UTC offset for this date in the target timezone (e.g. "GMT+05:30", "GMT-04:00", "GMT")
  const tzNamePart = new Intl.DateTimeFormat("en-US", {
    timeZone: targetTz,
    timeZoneName: "longOffset",
  })
    .formatToParts(referenceDate)
    .find((p) => p.type === "timeZoneName")?.value;

  let offset = "+00:00";
  if (tzNamePart) {
    const rawOffset = tzNamePart.replace("GMT", "").trim();
    if (rawOffset.startsWith("+") || rawOffset.startsWith("-")) {
      offset = rawOffset;
    }
  }

  const startOfDay = new Date(`${dateParts}T00:00:00.000${offset}`);
  const endOfDay = new Date(`${dateParts}T23:59:59.999${offset}`);

  return { startOfDay, endOfDay, dateString: dateParts };
}

export class DriverOperationsService {
  /**
   * Resolves the comprehensive, live operational context for an authenticated driver.
   *
   * Aggregates:
   * 1. Driver Profile status & verification state
   * 2. Active vehicle (assigned to active trip, or currently active registered vehicle)
   * 3. Current active or created Trip context
   * 4. In-flight active Rides under the active trip
   * 5. Today's completed ride statistics in driver local timezone
   */
  async getDriverOperationalContext(
    driverProfileId: string | Types.ObjectId,
    timezone = "Asia/Kolkata"
  ): Promise<DriverOperationalContextResponse> {
    const driverId = new Types.ObjectId(driverProfileId);

    // 1. Fetch Driver Profile
    const profile = await DriverProfileModel.findById(driverId);
    if (!profile) {
      throw new NotFoundError(
        "Driver profile not found.",
        ERROR_CODES.DRIVER_PROFILE_NOT_FOUND
      );
    }

    // 2. Resolve Active / Created Trip
    const activeTripDoc = await TripModel.findOne({
      driverId,
      status: { $in: [TripStatus.ACTIVE, TripStatus.CREATED] },
    }).sort({ createdAt: -1 });

    const activeTrip = activeTripDoc ? toCleanTripResponse(activeTripDoc) : null;

    // 3. Resolve Active Vehicle
    let activeVehicleDoc = null;
    if (activeTripDoc && activeTripDoc.vehicleId) {
      activeVehicleDoc = await VehicleModel.findById(activeTripDoc.vehicleId);
    }

    if (!activeVehicleDoc) {
      activeVehicleDoc = await VehicleModel.findOne({
        driverId,
        isActive: true,
      }).sort({ updatedAt: -1 });
    }

    const vehicle = activeVehicleDoc ? toCleanVehicleResponse(activeVehicleDoc) : null;

    // 4. Resolve In-flight Active Rides
    const activeRideStatuses = [
      RideStatus.CREATED,
      RideStatus.DRIVER_ARRIVING,
      RideStatus.PICKED_UP,
      RideStatus.IN_PROGRESS,
    ];

    const activeRideQuery: Record<string, any> = {
      driverId,
      status: { $in: activeRideStatuses },
    };

    if (activeTripDoc) {
      activeRideQuery.tripId = activeTripDoc._id;
    }

    const activeRideDocs = await RideModel.find(activeRideQuery).sort({
      createdAt: -1,
    });

    const activeRides = activeRideDocs.map(toRideResponse);

    // 5. Compute Today's Stats in Driver's Timezone
    const { startOfDay, endOfDay, dateString } = getTimezoneDayBounds(
      new Date(),
      timezone
    );

    const completedRidesCount = await RideModel.countDocuments({
      driverId,
      status: RideStatus.COMPLETED,
      completedAt: { $gte: startOfDay, $lte: endOfDay },
    });

    const isOnline =
      profile.status === DriverStatus.ONLINE ||
      profile.status === DriverStatus.ON_RIDE;

    return {
      driver: {
        id: profile._id.toString(),
        userId: profile.userId.toString(),
        verificationStatus: profile.verificationStatus,
        status: profile.status,
        licenseNumberMasked: maskLicenseNumber(profile.licenseNumber),
        licenseVerifiedAt: profile.licenseVerifiedAt
          ? profile.licenseVerifiedAt.toISOString()
          : null,
      },
      vehicle,
      activeTrip,
      activeRides,
      todayStats: {
        completedRidesCount,
        isOnline,
        currentDate: dateString,
        timezone,
      },
    };
  }
}

export const driverOperationsService = new DriverOperationsService();
