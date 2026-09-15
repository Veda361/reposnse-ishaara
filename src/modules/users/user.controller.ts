import { Response } from "express";
import { AuthenticatedRequest } from "../../shared/types/common.types";
import { userService } from "./user.service";
import { toCleanUserResponse } from "./user.model";
import { sendSuccess } from "../../shared/responses/api-response";
import { HTTP_STATUS } from "../../shared/constants/api.constants";
import { OnboardingInput, UpdateProfileInput } from "./user.schema";
import { UnauthorizedError } from "../../shared/errors/app-error";

export class UserController {
  /**
   * GET /api/v1/users/me
   * Returns the authenticated Isahara application user profile.
   * Does NOT return session tokens, OAuth secrets, or internal database metadata.
   */
  getMe = async (req: AuthenticatedRequest, res: Response): Promise<Response> => {
    if (!req.auth?.user) {
      throw new UnauthorizedError("Authentication required.");
    }

    const cleanUser = toCleanUserResponse(req.auth.user);
    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: cleanUser,
    });
  };

  /**
   * POST /api/v1/users/me/onboarding
   * Assigns the chosen application role (USER or DRIVER_CONDUCTOR).
   * Strictly enforces that onboarding can only be completed once.
   */
  completeOnboarding = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> => {
    if (!req.auth?.user) {
      throw new UnauthorizedError("Authentication required.");
    }

    const { role } = req.body as OnboardingInput;

    const updatedUser = await userService.completeOnboarding(
      req.auth.user._id.toString(),
      role
    );

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: toCleanUserResponse(updatedUser),
      message: "Onboarding completed successfully.",
    });
  };

  /**
   * PATCH /api/v1/users/me
   * Updates only safe profile attributes (name, phoneNumber, image).
   * Ignores/rejects role or internal security state changes.
   */
  updateMe = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> => {
    if (!req.auth?.user) {
      throw new UnauthorizedError("Authentication required.");
    }

    const safeUpdateData = req.body as UpdateProfileInput;

    const updatedUser = await userService.updateUserProfile(
      req.auth.user._id.toString(),
      safeUpdateData
    );

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.OK,
      data: toCleanUserResponse(updatedUser),
      message: "Profile updated successfully.",
    });
  };
}

export const userController = new UserController();
