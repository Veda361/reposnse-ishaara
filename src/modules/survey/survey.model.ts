import mongoose, { Document, Schema } from "mongoose";
import {
  USUAL_TRAVEL_MODES,
  DIFFICULTY_FINDING_RIDES,
  PROBLEMS_FACED,
  LONGEST_WAITS,
  NEEDED_URGENT_TRANSPORTS,
  SEEN_VEHICLE_GOING_MY_WAYS,
  NEARBY_VERIFIED_VEHICLE_USEFULS,
  TRUST_FACTORS,
  WOULD_USE_RIDE_SIGNALS,
  BIGGEST_PROBLEMS,
  WOULD_TRY_ISAHARAS,
} from "./survey.schema";

export interface IStudent {
  name?: string;
  college: string;
  yearOfStudy?: string;
  contact?: string;
  interestedInPilot: boolean;
}

export interface ITravel {
  usualTravelMode: (typeof USUAL_TRAVEL_MODES)[number];
  difficultyFindingRide: (typeof DIFFICULTY_FINDING_RIDES)[number];
  problemsFaced: (typeof PROBLEMS_FACED)[number][];
  longestWait: (typeof LONGEST_WAITS)[number];
}

export interface ISurveyResponse extends Document {
  student: IStudent;
  travel: ITravel;
  neededUrgentTransport: (typeof NEEDED_URGENT_TRANSPORTS)[number];
  seenVehicleGoingMyWay: (typeof SEEN_VEHICLE_GOING_MY_WAYS)[number];
  nearbyVerifiedVehicleUseful: (typeof NEARBY_VERIFIED_VEHICLE_USEFULS)[number];
  trustFactors: (typeof TRUST_FACTORS)[number][];
  wouldUseRideSignal: (typeof WOULD_USE_RIDE_SIGNALS)[number];
  biggestProblem: (typeof BIGGEST_PROBLEMS)[number];
  wouldTryIsahara: (typeof WOULD_TRY_ISAHARAS)[number];
  improvementSuggestion?: string;
  createdAt: Date;
  updatedAt: Date;
}

const StudentSchema = new Schema<IStudent>(
  {
    name: { type: String, trim: true },
    college: { type: String, required: true, trim: true, index: true },
    yearOfStudy: { type: String, trim: true },
    contact: { type: String, trim: true },
    interestedInPilot: { type: Boolean, required: true, index: true },
  },
  { _id: false }
);

const TravelSchema = new Schema<ITravel>(
  {
    usualTravelMode: {
      type: String,
      required: true,
      enum: USUAL_TRAVEL_MODES,
      index: true,
    },
    difficultyFindingRide: {
      type: String,
      required: true,
      enum: DIFFICULTY_FINDING_RIDES,
    },
    problemsFaced: {
      type: [String],
      required: true,
      enum: PROBLEMS_FACED,
    },
    longestWait: {
      type: String,
      required: true,
      enum: LONGEST_WAITS,
    },
  },
  { _id: false }
);

const SurveyResponseSchema = new Schema<ISurveyResponse>(
  {
    student: {
      type: StudentSchema,
      required: true,
    },
    travel: {
      type: TravelSchema,
      required: true,
    },
    neededUrgentTransport: {
      type: String,
      required: true,
      enum: NEEDED_URGENT_TRANSPORTS,
    },
    seenVehicleGoingMyWay: {
      type: String,
      required: true,
      enum: SEEN_VEHICLE_GOING_MY_WAYS,
    },
    nearbyVerifiedVehicleUseful: {
      type: String,
      required: true,
      enum: NEARBY_VERIFIED_VEHICLE_USEFULS,
    },
    trustFactors: {
      type: [String],
      required: true,
      enum: TRUST_FACTORS,
    },
    wouldUseRideSignal: {
      type: String,
      required: true,
      enum: WOULD_USE_RIDE_SIGNALS,
    },
    biggestProblem: {
      type: String,
      required: true,
      enum: BIGGEST_PROBLEMS,
    },
    wouldTryIsahara: {
      type: String,
      required: true,
      enum: WOULD_TRY_ISAHARAS,
      index: true,
    },
    improvementSuggestion: {
      type: String,
      trim: true,
    },
  },
  {
    collection: "survey_responses",
    timestamps: true,
  }
);

// Compound index for search / analytics filtering
SurveyResponseSchema.index({ "student.college": 1, createdAt: -1 });

export const SurveyResponse = mongoose.model<ISurveyResponse>(
  "SurveyResponse",
  SurveyResponseSchema
);
