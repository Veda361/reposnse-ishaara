import { SurveyResponse } from "./survey.model";

export interface AnalyticsFilterQuery {
  college?: string;
  yearOfStudy?: string;
  startDate?: string;
  endDate?: string;
  from?: string;
  to?: string;
}

export class AnalyticsService {
  /**
   * Aggregates survey statistics using high-performance MongoDB aggregation pipelines.
   * Leverages $facet to compute all breakdowns in a single database round-trip.
   */
  async getOverview(filterQuery: AnalyticsFilterQuery) {
    const matchStage: Record<string, any> = {};

    if (filterQuery.college) {
      matchStage["student.college"] = {
        $regex: new RegExp(filterQuery.college, "i"),
      };
    }

    if (filterQuery.yearOfStudy) {
      matchStage["student.yearOfStudy"] = {
        $regex: new RegExp(filterQuery.yearOfStudy, "i"),
      };
    }

    const start = filterQuery.startDate || filterQuery.from;
    const end = filterQuery.endDate || filterQuery.to;

    if (start || end) {
      matchStage.createdAt = {};
      if (start) {
        matchStage.createdAt.$gte = new Date(start);
      }
      if (end) {
        matchStage.createdAt.$lte = new Date(end);
      }
    }

    const pipeline = [
      { $match: matchStage },
      {
        $facet: {
          totalCount: [{ $count: "count" }],
          transportModes: [
            {
              $group: {
                _id: "$travel.usualTravelMode",
                count: { $sum: 1 },
              },
            },
          ],
          rideDifficulty: [
            {
              $group: {
                _id: "$travel.difficultyFindingRide",
                count: { $sum: 1 },
              },
            },
          ],
          commonProblems: [
            { $unwind: "$travel.problemsFaced" },
            {
              $group: {
                _id: "$travel.problemsFaced",
                count: { $sum: 1 },
              },
            },
            { $sort: { count: -1 as const } },
          ],
          waitingTimes: [
            {
              $group: {
                _id: "$travel.longestWait",
                count: { $sum: 1 },
              },
            },
          ],
          urgentTransport: [
            {
              $group: {
                _id: "$neededUrgentTransport",
                count: { $sum: 1 },
              },
            },
          ],
          vehicleGoingSameDirection: [
            {
              $group: {
                _id: "$seenVehicleGoingMyWay",
                count: { $sum: 1 },
              },
            },
          ],
          isaharaUsefulness: [
            {
              $group: {
                _id: "$nearbyVerifiedVehicleUseful",
                count: { $sum: 1 },
              },
            },
          ],
          trustFactors: [
            { $unwind: "$trustFactors" },
            {
              $group: {
                _id: "$trustFactors",
                count: { $sum: 1 },
              },
            },
            { $sort: { count: -1 as const } },
          ],
          rideSignalInterest: [
            {
              $group: {
                _id: "$wouldUseRideSignal",
                count: { $sum: 1 },
              },
            },
          ],
          biggestProblem: [
            {
              $group: {
                _id: "$biggestProblem",
                count: { $sum: 1 },
              },
            },
          ],
          isaharaAdoption: [
            {
              $group: {
                _id: "$wouldTryIsahara",
                count: { $sum: 1 },
              },
            },
          ],
          pilotInterest: [
            {
              $group: {
                _id: "$student.interestedInPilot",
                count: { $sum: 1 },
              },
            },
          ],
        },
      },
    ];

    const [result] = await SurveyResponse.aggregate(pipeline);

    // Convert MongoDB group arrays [{ _id: 'auto', count: 12 }] to clean dictionary objects { auto: 12 }
    const toMap = (arr: Array<{ _id: any; count: number }>) => {
      const obj: Record<string, number> = {};
      if (!arr) return obj;
      for (const item of arr) {
        if (item._id !== null && item._id !== undefined) {
          obj[String(item._id)] = item.count;
        }
      }
      return obj;
    };

    const totalResponses =
      result?.totalCount && result.totalCount.length > 0
        ? result.totalCount[0].count
        : 0;

    return {
      totalResponses,
      transportModes: toMap(result?.transportModes || []),
      rideDifficulty: toMap(result?.rideDifficulty || []),
      commonProblems: toMap(result?.commonProblems || []),
      waitingTimes: toMap(result?.waitingTimes || []),
      urgentTransport: toMap(result?.urgentTransport || []),
      vehicleGoingSameDirection: toMap(result?.vehicleGoingSameDirection || []),
      isaharaUsefulness: toMap(result?.isaharaUsefulness || []),
      trustFactors: toMap(result?.trustFactors || []),
      rideSignalInterest: toMap(result?.rideSignalInterest || []),
      biggestProblem: toMap(result?.biggestProblem || []),
      isaharaAdoption: toMap(result?.isaharaAdoption || []),
      pilotInterest: toMap(result?.pilotInterest || []),
    };
  }
}

export const analyticsService = new AnalyticsService();
