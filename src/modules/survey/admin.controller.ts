import { Request, Response } from "express";
import { Parser } from "json2csv";
import { surveyService } from "./survey.service";
import { analyticsService } from "./analytics.service";
import { sendSuccess } from "../../shared/responses/api-response";
import { NotFoundError } from "../../shared/errors/app-error";

export class AdminController {
  /**
   * List survey responses with pagination, sorting, search, and filters.
   * GET /api/v1/admin/surveys
   */
  async getSurveys(req: Request, res: Response): Promise<Response> {
    const {
      page,
      limit,
      college,
      wouldTryIsahara,
      interestedInPilot,
      search,
      sortBy,
      sortOrder,
    } = req.query;

    const result = await surveyService.getSurveys({
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      college: college as string | undefined,
      wouldTryIsahara: wouldTryIsahara as string | undefined,
      interestedInPilot: interestedInPilot as string | undefined,
      search: search as string | undefined,
      sortBy: sortBy as string | undefined,
      sortOrder: sortOrder as "asc" | "desc" | undefined,
    });

    return sendSuccess({
      res,
      data: result,
    });
  }

  /**
   * Retrieve a single survey response by ID.
   * GET /api/v1/admin/surveys/:id
   */
  async getSurveyById(req: Request, res: Response): Promise<Response> {
    const { id } = req.params;
    const survey = await surveyService.getSurveyById(id);

    if (!survey) {
      throw new NotFoundError(`Survey response with ID ${id} was not found`);
    }

    return sendSuccess({
      res,
      data: survey,
    });
  }

  /**
   * Delete a survey response by ID.
   * DELETE /api/v1/admin/surveys/:id
   */
  async deleteSurveyById(req: Request, res: Response): Promise<Response> {
    const { id } = req.params;
    const deleted = await surveyService.deleteSurveyById(id);

    if (!deleted) {
      throw new NotFoundError(`Survey response with ID ${id} was not found`);
    }

    return sendSuccess({
      res,
      message: "Survey response deleted successfully",
    });
  }

  /**
   * Aggregated analytics overview with optional filtering.
   * GET /api/v1/admin/analytics/overview
   */
  async getAnalyticsOverview(req: Request, res: Response): Promise<Response> {
    const { college, yearOfStudy, startDate, endDate, from, to } = req.query;

    const overview = await analyticsService.getOverview({
      college: college as string | undefined,
      yearOfStudy: yearOfStudy as string | undefined,
      startDate: (startDate || from) as string | undefined,
      endDate: (endDate || to) as string | undefined,
    });

    return sendSuccess({
      res,
      data: overview,
    });
  }

  /**
   * Export survey responses as CSV download.
   * GET /api/v1/admin/surveys/export
   */
  async exportSurveysCsv(req: Request, res: Response): Promise<Response> {
    const { college, wouldTryIsahara, interestedInPilot } = req.query;

    const filter: Record<string, any> = {};
    if (college) {
      filter["student.college"] = { $regex: new RegExp(String(college), "i") };
    }
    if (wouldTryIsahara) {
      filter["wouldTryIsahara"] = String(wouldTryIsahara);
    }
    if (interestedInPilot !== undefined) {
      filter["student.interestedInPilot"] =
        interestedInPilot === "true" || (interestedInPilot as unknown) === true;
    }

    const records = await surveyService.getSurveysForExport(filter);

    // Flatten structure for clean CSV columns
    const flatRecords = records.map((r: any) => ({
      id: r._id?.toString(),
      studentName: r.student?.name || "",
      college: r.student?.college || "",
      yearOfStudy: r.student?.yearOfStudy || "",
      contact: r.student?.contact || "",
      interestedInPilot: r.student?.interestedInPilot ? "Yes" : "No",
      usualTravelMode: r.travel?.usualTravelMode || "",
      difficultyFindingRide: r.travel?.difficultyFindingRide || "",
      problemsFaced: (r.travel?.problemsFaced || []).join("; "),
      longestWait: r.travel?.longestWait || "",
      neededUrgentTransport: r.neededUrgentTransport || "",
      seenVehicleGoingMyWay: r.seenVehicleGoingMyWay || "",
      nearbyVerifiedVehicleUseful: r.nearbyVerifiedVehicleUseful || "",
      trustFactors: (r.trustFactors || []).join("; "),
      wouldUseRideSignal: r.wouldUseRideSignal || "",
      biggestProblem: r.biggestProblem || "",
      wouldTryIsahara: r.wouldTryIsahara || "",
      improvementSuggestion: r.improvementSuggestion || "",
      submittedAt: r.createdAt ? new Date(r.createdAt).toISOString() : "",
    }));

    const fields = [
      "id",
      "studentName",
      "college",
      "yearOfStudy",
      "contact",
      "interestedInPilot",
      "usualTravelMode",
      "difficultyFindingRide",
      "problemsFaced",
      "longestWait",
      "neededUrgentTransport",
      "seenVehicleGoingMyWay",
      "nearbyVerifiedVehicleUseful",
      "trustFactors",
      "wouldUseRideSignal",
      "biggestProblem",
      "wouldTryIsahara",
      "improvementSuggestion",
      "submittedAt",
    ];

    const parser = new Parser({ fields });
    const csv = parser.parse(flatRecords);

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="isahara_surveys_${timestamp}.csv"`
    );

    return res.status(200).send(csv);
  }
}

export const adminController = new AdminController();
