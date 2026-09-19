import { Response } from "express";
import { AuthenticatedRequest } from "../../shared/types/common.types";
import { RatingService, ratingService } from "./rating.service";
import { RatingSummaryService, ratingSummaryService } from "./rating-summary.service";
import { driverService } from "../drivers/driver.service";
import { sendSuccess } from "../../shared/responses/api-response";
import { HTTP_STATUS } from "../../shared/constants/api.constants";
import { UnauthorizedError } from "../../shared/errors/app-error";
import { ERROR_CODES } from "../../shared/errors/error-codes";
import { Role, ROLES } from "../../shared/constants/roles.constants";
import { SubmitRatingInput } from "./rating.schema";

/**
 * Phase 14: RatingController
 *
 * THIN LAYER: This controller only handles HTTP concerns:
 * - Extract authenticated identity from request
 * - Parse validated body/params
 * - Delegate to RatingService
 * - Format response
 *
 * ALL business logic is in RatingService. No authorization logic here
 * beyond extracting the caller's identity.
 *
 * CLIENT IDENTITY RULE:
 * The client NEVER supplies reviewerUserId, revieweeUserId, or any identity field.
 * The controller derives callerId and callerRole from the authenticated session
 * and passes them to the service, which derives everything else from the Ride.
 */
export class RatingController {
  private service: RatingService;
  private summaryService: RatingSummaryService;

  constructor(service?: RatingService, summary?: RatingSummaryService) {
    this.service = service ?? ratingService;
    this.summaryService = summary ?? ratingSummaryService;
  }

  /**
   * Resolves the authenticated user's application User._id.
   * Throws UnauthorizedError if identity cannot be determined.
   */
  private resolveUserId(req: AuthenticatedRequest): string {
    const userId = req.auth?.applicationUserId || req.user?.id;
    if (!userId) {
      throw new UnauthorizedError("Authentication required.", ERROR_CODES.UNAUTHORIZED);
    }
    return userId;
  }

  /**
   * Resolves the authenticated user's role.
   */
  private resolveRole(req: AuthenticatedRequest): Role {
    return (req.auth?.user?.role || req.user?.role) as Role;
  }

  /**
   * Resolves the authenticated driver's DriverProfile._id.
   * Only called when callerRole === DRIVER_CONDUCTOR.
   */
  private async resolveDriverProfileId(req: AuthenticatedRequest): Promise<string> {
    const userId = this.resolveUserId(req);
    const driverProfile = await driverService.getDriverProfileByUserId(userId);
    return driverProfile._id.toString();
  }

  /**
   * GET /api/v1/rides/:rideId/rating-eligibility
   *
   * Returns whether the authenticated caller can submit a rating for this ride.
   * Safe to call repeatedly — no side effects.
   *
   * Response: { eligible: boolean, alreadyRated: boolean, reason?: string }
   */
  getRatingEligibility = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> => {
    const userId = this.resolveUserId(req);
    const role = this.resolveRole(req);
    const { rideId } = req.params;

    let callerDriverProfileId: string | undefined;
    if (role === ROLES.DRIVER_CONDUCTOR) {
      callerDriverProfileId = await this.resolveDriverProfileId(req);
    }

    const eligibility = await this.service.checkEligibility(rideId, {
      callerId: userId,
      callerRole: role,
      callerDriverProfileId,
    });

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: eligibility,
    });
  };

  /**
   * POST /api/v1/rides/:rideId/ratings
   *
   * Submits a rating for a completed ride.
   *
   * SECURITY:
   * - Caller identity derived from JWT — never from request body
   * - Reviewee derived from Ride document — never from request body
   * - Idempotency-Key header supported for mobile retry safety
   *
   * Request body: { score: number, review?: string }
   * Response: { id, rideId, score, review, createdAt }
   */
  submitRating = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> => {
    const userId = this.resolveUserId(req);
    const role = this.resolveRole(req);
    const { rideId } = req.params;
    const input = req.body as SubmitRatingInput;

    // Extract idempotency key from header — NOT from body
    const idempotencyKey = req.headers["idempotency-key"] as string | undefined;

    let callerDriverProfileId: string | undefined;
    if (role === ROLES.DRIVER_CONDUCTOR) {
      callerDriverProfileId = await this.resolveDriverProfileId(req);
    }

    const rating = await this.service.submitRating(
      rideId,
      {
        callerId: userId,
        callerRole: role,
        callerDriverProfileId,
        idempotencyKey,
      },
      input
    );

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.CREATED,
      data: rating,
      message: "Rating submitted successfully.",
    });
  };

  /**
   * GET /api/v1/rides/:rideId/ratings
   *
   * Retrieves ratings for a specific ride.
   * Only authorized participants can access this endpoint.
   *
   * PRIVACY: Reviewer identity is not exposed in the response.
   */
  getRatingsByRide = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> => {
    const userId = this.resolveUserId(req);
    const role = this.resolveRole(req);
    const { rideId } = req.params;

    let callerDriverProfileId: string | undefined;
    if (role === ROLES.DRIVER_CONDUCTOR) {
      callerDriverProfileId = await this.resolveDriverProfileId(req);
    }

    const ratings = await this.service.getRatingsByRide(rideId, {
      callerId: userId,
      callerRole: role,
      callerDriverProfileId,
    });

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: ratings,
    });
  };

  /**
   * GET /api/v1/drivers/me/rating-summary
   *
   * Returns the authenticated driver's aggregate rating summary.
   * { driverId, averageScore: number|null, ratingCount: number }
   *
   * averageScore is null for drivers with no ratings (prevents 0-star ambiguity).
   * scoreSum is intentionally excluded from the public response.
   */
  getMyRatingSummary = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> => {
    const driverProfileId = await this.resolveDriverProfileId(req);

    const summary = await this.summaryService.getSummary(driverProfileId);

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: summary,
    });
  };
}

export const ratingController = new RatingController();
