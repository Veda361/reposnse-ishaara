import { Request, Response } from "express";
import { surveyService } from "./survey.service";
import { sendSuccess } from "../../shared/responses/api-response";
import { HTTP_STATUS } from "../../shared/constants/api.constants";

export class SurveyController {
  /**
   * Public survey submission handler.
   * POST /api/v1/survey
   */
  async submitSurvey(req: Request, res: Response): Promise<Response> {
    // req.body has already been validated and sanitized by validateBody middleware
    await surveyService.createSurveyResponse(req.body);

    return sendSuccess({
      res,
      statusCode: HTTP_STATUS.CREATED,
      message: "Survey submitted successfully",
    });
  }
}

export const surveyController = new SurveyController();
