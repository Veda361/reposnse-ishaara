import { SurveyResponse, ISurveyResponse } from "./survey.model";
import { CreateSurveyInput } from "./survey.schema";

export interface GetSurveysQuery {
  page?: number;
  limit?: number;
  college?: string;
  wouldTryIsahara?: string;
  interestedInPilot?: boolean | string;
  search?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export class SurveyService {
  /**
   * Persists a validated survey response in MongoDB.
   */
  async createSurveyResponse(data: CreateSurveyInput): Promise<ISurveyResponse> {
    const surveyResponse = new SurveyResponse(data);
    return await surveyResponse.save();
  }

  /**
   * Retrieves paginated survey responses with search & filtering.
   */
  async getSurveys(query: GetSurveysQuery) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const skip = (page - 1) * limit;

    const filter: Record<string, any> = {};

    if (query.college) {
      filter["student.college"] = { $regex: new RegExp(query.college, "i") };
    }

    if (query.wouldTryIsahara) {
      filter["wouldTryIsahara"] = query.wouldTryIsahara;
    }

    if (query.interestedInPilot !== undefined) {
      if (query.interestedInPilot === true || query.interestedInPilot === "true") {
        filter["student.interestedInPilot"] = true;
      } else if (
        query.interestedInPilot === false ||
        query.interestedInPilot === "false"
      ) {
        filter["student.interestedInPilot"] = false;
      }
    }

    if (query.search) {
      const searchRegex = new RegExp(query.search, "i");
      filter.$or = [
        { "student.name": { $regex: searchRegex } },
        { "student.college": { $regex: searchRegex } },
        { "student.yearOfStudy": { $regex: searchRegex } },
      ];
    }

    const sortField = query.sortBy || "createdAt";
    const sortDirection = query.sortOrder === "asc" ? 1 : -1;

    const [responses, total] = await Promise.all([
      SurveyResponse.find(filter)
        .sort({ [sortField]: sortDirection })
        .skip(skip)
        .limit(limit)
        .lean(),
      SurveyResponse.countDocuments(filter),
    ]);

    const totalPages = Math.ceil(total / limit) || 1;

    return {
      responses,
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
    };
  }

  /**
   * Retrieves a single survey response by ID.
   */
  async getSurveyById(id: string): Promise<Record<string, any> | null> {
    return await SurveyResponse.findById(id).lean();
  }

  /**
   * Deletes a single survey response by ID safely.
   */
  async deleteSurveyById(id: string): Promise<boolean> {
    const result = await SurveyResponse.findByIdAndDelete(id);
    return !!result;
  }

  /**
   * Fetches all survey responses matching filters for CSV export.
   */
  async getSurveysForExport(filter: Record<string, any> = {}) {
    return await SurveyResponse.find(filter).sort({ createdAt: -1 }).lean();
  }
}

export const surveyService = new SurveyService();
