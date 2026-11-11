import { Router } from "express";
import { rideRequestController } from "./ride-request.controller.js";
import {
  requireAuth,
  requireUser,
  requireDriverConductor,
} from "../../middleware/authorization.js";
import { validateBody, validateQuery } from "../../middleware/validation.js";
import {
  createRideRequestSchema,
  cancelRideRequestSchema,
  rejectRideRequestSchema,
  listRideRequestsQuerySchema,
} from "./ride-request.schema.js";
import { rideRequestRateLimiter } from "../../middleware/rate-limit.js";
import { asyncHandler } from "../../shared/utils/async-handler.js";

const router = Router();

/**
 * All RideRequest endpoints require authenticated session.
 */
router.use(requireAuth);

/**
 * POST /api/v1/ride-requests
 * Passenger requests a ride on an active trip.
 */
router.post(
  "/",
  requireUser,
  rideRequestRateLimiter,
  validateBody(createRideRequestSchema),
  asyncHandler((req, res) => rideRequestController.create(req, res))
);

/**
 * GET /api/v1/ride-requests/me
 * Passenger listing alias for current user's requests.
 */
router.get(
  "/me",
  requireUser,
  validateQuery(listRideRequestsQuerySchema),
  asyncHandler((req, res) => rideRequestController.listUserRequests(req, res))
);

/**
 * GET /api/v1/ride-requests/:requestId
 * Retrieves request by ID for authorized passenger or driver.
 */
router.get(
  "/:requestId",
  asyncHandler((req, res) => rideRequestController.getById(req, res))
);

/**
 * POST /api/v1/ride-requests/:requestId/cancel
 * Passenger cancels their pending request.
 */
router.post(
  "/:requestId/cancel",
  requireUser,
  validateBody(cancelRideRequestSchema),
  asyncHandler((req, res) => rideRequestController.cancel(req, res))
);

/**
 * POST /api/v1/ride-requests/:requestId/accept
 * Driver accepts a pending request for their trip.
 */
router.post(
  "/:requestId/accept",
  requireDriverConductor,
  asyncHandler((req, res) => rideRequestController.accept(req, res))
);

/**
 * POST /api/v1/ride-requests/:requestId/reject
 * Driver rejects a pending request for their trip.
 */
router.post(
  "/:requestId/reject",
  requireDriverConductor,
  validateBody(rejectRideRequestSchema),
  asyncHandler((req, res) => rideRequestController.reject(req, res))
);

export default router;
