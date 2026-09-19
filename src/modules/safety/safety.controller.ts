import { Response } from "express";
import { AuthenticatedRequest } from "../../shared/types/common.types";
import { SafetyService, safetyService } from "./safety.service";
import { sendSuccess } from "../../shared/responses/api-response";
import { HTTP_STATUS } from "../../shared/constants/api.constants";
import { UnauthorizedError, NotFoundError } from "../../shared/errors/app-error";
import { ERROR_CODES } from "../../shared/errors/error-codes";
import { Role } from "../../shared/constants/roles.constants";
import { CreateSosInput, CancelSosInput } from "./safety.schema";

/**
 * Phase 15: SafetyController
 *
 * THIN LAYER: Handles only HTTP concerns:
 * - Extract authenticated identity from session (never from request body)
 * - Read Idempotency-Key header
 * - Delegate to SafetyService
 * - Format response
 *
 * IDENTITY RULE:
 * - callerUserId is ALWAYS derived from req.auth / req.user — never from body/params
 * - rideId, driverId, passengerUserId are ALWAYS derived server-side from the Ride document
 * - Client may supply only: emergencyType, Idempotency-Key header, optional cancel reason
 */
export class SafetyController {
  private service: SafetyService;

  constructor(service?: SafetyService) {
    this.service = service ?? safetyService;
  }

  /**
   * Resolves authenticated user's application User._id.
   * Throws UnauthorizedError if not available.
   */
  private resolveUserId(req: AuthenticatedRequest): string {
    const userId = req.auth?.applicationUserId || req.user?.id;
    if (!userId) {
      throw new UnauthorizedError("Authentication required.", ERROR_CODES.UNAUTHORIZED);
    }
    return userId;
  }

  /**
   * Resolves authenticated user's role.
   */
  private resolveRole(req: AuthenticatedRequest): Role {
    return (req.auth?.user?.role || req.user?.role) as Role;
  }

  /**
   * POST /api/v1/rides/:rideId/safety/sos
   * Triggers an SOS emergency event for an active ride.
   * Supports Idempotency-Key header for safe retries.
   *
   * Response: 201 Created with EmergencyEventResponse
   */
  async triggerSOS(req: AuthenticatedRequest, res: Response): Promise<void> {
    const callerUserId = this.resolveUserId(req);
    const callerRole = this.resolveRole(req);
    const { rideId } = req.params;
    const input = req.body as CreateSosInput;
    // Read optional Idempotency-Key header (case-insensitive)
    const idempotencyKey =
      (req.headers["idempotency-key"] as string | undefined) ||
      (req.headers["Idempotency-Key"] as string | undefined);

    const event = await this.service.triggerSOS(
      callerUserId,
      callerRole,
      rideId,
      input,
      idempotencyKey
    );

    sendSuccess({
      res,
      statusCode: HTTP_STATUS.CREATED,
      data: event,
      message: "SOS emergency event triggered successfully.",
    });
  }

  /**
   * GET /api/v1/rides/:rideId/safety/active
   * Returns the active SOS event for the ride, or null if none exists.
   * Caller must be a ride participant.
   *
   * Response: 200 OK with EmergencyEventResponse or null
   */
  async getActiveSOSForRide(req: AuthenticatedRequest, res: Response): Promise<void> {
    const callerUserId = this.resolveUserId(req);
    const callerRole = this.resolveRole(req);
    const { rideId } = req.params;

    const event = await this.service.getActiveSOSForRide(callerUserId, callerRole, rideId);

    sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: event,
      message: event ? "Active SOS event found." : "No active SOS event for this ride.",
    });
  }

  /**
   * GET /api/v1/rides/:rideId/safety/events
   * Returns paginated safety event history for the ride.
   * Caller must be a ride participant.
   *
   * Response: 200 OK with EmergencyEventResponse[]
   */
  async listEventsForRide(req: AuthenticatedRequest, res: Response): Promise<void> {
    const callerUserId = this.resolveUserId(req);
    const callerRole = this.resolveRole(req);
    const { rideId } = req.params;
    const limit = Math.min(parseInt((req.query.limit as string) || "20", 10), 50);
    const skip = Math.max(parseInt((req.query.skip as string) || "0", 10), 0);

    const events = await this.service.listEventsForRide(
      callerUserId,
      callerRole,
      rideId,
      limit,
      skip
    );

    sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: events,
    });
  }

  /**
   * GET /api/v1/safety/events/:eventId
   * Retrieves a specific emergency event by its event ID.
   * Caller must be a participant of the associated ride.
   *
   * Response: 200 OK with EmergencyEventResponse
   */
  async getSOSById(req: AuthenticatedRequest, res: Response): Promise<void> {
    const callerUserId = this.resolveUserId(req);
    const callerRole = this.resolveRole(req);
    const { eventId } = req.params;

    const event = await this.service.getSOSById(callerUserId, callerRole, eventId);

    sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: event,
    });
  }

  /**
   * POST /api/v1/safety/events/:eventId/cancel
   * Cancels an active SOS event.
   * Only the triggering participant may cancel their own SOS.
   *
   * Response: 200 OK with cancelled EmergencyEventResponse
   */
  async cancelSOS(req: AuthenticatedRequest, res: Response): Promise<void> {
    const callerUserId = this.resolveUserId(req);
    const callerRole = this.resolveRole(req);
    const { eventId } = req.params;
    const input = req.body as CancelSosInput;

    const event = await this.service.cancelSOS(callerUserId, callerRole, eventId, input);

    sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: event,
      message: "SOS event cancelled.",
    });
  }

  /**
   * POST /api/v1/rides/:rideId/safety/cancel
   * Ride-scoped cancel: looks up the caller's active SOS on the ride and cancels it.
   * Convenience endpoint — same authorization semantics as /safety/events/:eventId/cancel.
   *
   * Response: 200 OK with cancelled EmergencyEventResponse
   */
  async cancelSOSByRide(req: AuthenticatedRequest, res: Response): Promise<void> {
    const callerUserId = this.resolveUserId(req);
    const callerRole = this.resolveRole(req);
    const { rideId } = req.params;
    const input = req.body as CancelSosInput;

    // Find the caller's active SOS on this ride and cancel it
    const activeEvent = await this.service.getActiveSOSForRide(callerUserId, callerRole, rideId);
    if (!activeEvent) {
      throw new NotFoundError("No active SOS event found for this ride.", ERROR_CODES.SAFETY_EVENT_NOT_FOUND);
    }

    const cancelled = await this.service.cancelSOS(
      callerUserId,
      callerRole,
      activeEvent.eventId,
      input
    );

    sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: cancelled,
      message: "SOS event cancelled.",
    });
  }
}

export const safetyController = new SafetyController();
