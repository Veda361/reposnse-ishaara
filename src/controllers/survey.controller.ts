import { Request, Response, NextFunction } from "express";
import { createSurveySchema } from "../validators/survey.validator";
import { surveyService } from "../services/survey.service";
import { sendSuccess } from "../utils/response";

export class SurveyController {
  /**
   * Public survey submission handler.
   * POST /api/v1/survey
   */
  async submitSurvey(req: Request, res: Response, next: NextFunction) {
    try {
      const validatedData = createSurveySchema.parse(req.body);
      await surveyService.createSurveyResponse(validatedData);

      return sendSuccess({
        res,
        statusCode: 201,
        message: "Survey submitted successfully",
      });
    } catch (error) {
      next(error);
    }
  }
}

export const surveyController = new SurveyController();
