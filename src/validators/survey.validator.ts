import { z } from "zod";

export const USUAL_TRAVEL_MODES = [
  "college_bus",
  "auto",
  "e_rickshaw",
  "cab",
  "bike",
  "scooty",
  "car",
  "walking",
  "pickup",
  "other",
] as const;

export const DIFFICULTY_FINDING_RIDES = [
  "often",
  "sometimes",
  "rarely",
  "never",
] as const;

export const PROBLEMS_FACED = [
  "no_vehicle",
  "long_wait",
  "cannot_find_vehicle_same_direction",
  "expensive",
  "safety",
  "urgent_need",
  "other",
] as const;

export const LONGEST_WAITS = [
  "under_5",
  "5_10",
  "10_20",
  "20_30",
  "over_30",
] as const;

export const NEEDED_URGENT_TRANSPORTS = [
  "yes_several_times",
  "yes_once",
  "no",
  "dont_remember",
] as const;

export const SEEN_VEHICLE_GOING_MY_WAYS = [
  "many_times",
  "sometimes",
  "rarely",
  "never",
] as const;

export const NEARBY_VERIFIED_VEHICLE_USEFULS = [
  "very_useful",
  "useful",
  "maybe",
  "not_useful",
] as const;

export const TRUST_FACTORS = [
  "driver_verified",
  "vehicle_number",
  "driver_details",
  "share_with_friend",
  "used_by_other_students",
  "would_not_trust_unknown_vehicle",
  "other",
] as const;

export const WOULD_USE_RIDE_SIGNALS = [
  "definitely",
  "probably",
  "maybe",
  "probably_not",
  "never",
] as const;

export const BIGGEST_PROBLEMS = [
  "long_wait",
  "no_vehicle",
  "finding_same_direction_vehicle",
  "cost",
  "safety",
  "emergency",
  "no_major_problem",
  "other",
] as const;

export const WOULD_TRY_ISAHARAS = [
  "definitely",
  "probably",
  "maybe",
  "probably_not",
  "definitely_not",
] as const;

export const createSurveySchema = z.object({
  student: z.object({
    name: z.string().trim().max(100, "Name must be at most 100 characters").optional(),
    college: z.string().trim().min(1, "College name is required").max(200, "College must be at most 200 characters"),
    yearOfStudy: z.string().trim().max(50, "Year of study must be at most 50 characters").optional(),
    contact: z.string().trim().max(100, "Contact must be at most 100 characters").optional(),
    interestedInPilot: z.boolean({
      required_error: "interestedInPilot is required",
      invalid_type_error: "interestedInPilot must be a boolean",
    }),
  }),

  travel: z.object({
    usualTravelMode: z.enum(USUAL_TRAVEL_MODES, {
      errorMap: () => ({ message: `usualTravelMode must be one of: ${USUAL_TRAVEL_MODES.join(", ")}` }),
    }),
    difficultyFindingRide: z.enum(DIFFICULTY_FINDING_RIDES, {
      errorMap: () => ({ message: `difficultyFindingRide must be one of: ${DIFFICULTY_FINDING_RIDES.join(", ")}` }),
    }),
    problemsFaced: z
      .array(
        z.enum(PROBLEMS_FACED, {
          errorMap: () => ({ message: `problemsFaced values must be one of: ${PROBLEMS_FACED.join(", ")}` }),
        })
      )
      .min(1, "At least one problem must be selected"),
    longestWait: z.enum(LONGEST_WAITS, {
      errorMap: () => ({ message: `longestWait must be one of: ${LONGEST_WAITS.join(", ")}` }),
    }),
  }),

  neededUrgentTransport: z.enum(NEEDED_URGENT_TRANSPORTS, {
    errorMap: () => ({ message: `neededUrgentTransport must be one of: ${NEEDED_URGENT_TRANSPORTS.join(", ")}` }),
  }),

  seenVehicleGoingMyWay: z.enum(SEEN_VEHICLE_GOING_MY_WAYS, {
    errorMap: () => ({ message: `seenVehicleGoingMyWay must be one of: ${SEEN_VEHICLE_GOING_MY_WAYS.join(", ")}` }),
  }),

  nearbyVerifiedVehicleUseful: z.enum(NEARBY_VERIFIED_VEHICLE_USEFULS, {
    errorMap: () => ({
      message: `nearbyVerifiedVehicleUseful must be one of: ${NEARBY_VERIFIED_VEHICLE_USEFULS.join(", ")}`,
    }),
  }),

  trustFactors: z
    .array(
      z.enum(TRUST_FACTORS, {
        errorMap: () => ({ message: `trustFactors values must be one of: ${TRUST_FACTORS.join(", ")}` }),
      })
    )
    .min(1, "At least one trust factor must be selected"),

  wouldUseRideSignal: z.enum(WOULD_USE_RIDE_SIGNALS, {
    errorMap: () => ({ message: `wouldUseRideSignal must be one of: ${WOULD_USE_RIDE_SIGNALS.join(", ")}` }),
  }),

  biggestProblem: z.enum(BIGGEST_PROBLEMS, {
    errorMap: () => ({ message: `biggestProblem must be one of: ${BIGGEST_PROBLEMS.join(", ")}` }),
  }),

  wouldTryIsahara: z.enum(WOULD_TRY_ISAHARAS, {
    errorMap: () => ({ message: `wouldTryIsahara must be one of: ${WOULD_TRY_ISAHARAS.join(", ")}` }),
  }),

  improvementSuggestion: z
    .string()
    .trim()
    .max(1000, "Improvement suggestion must be at most 1000 characters")
    .optional(),
});

export type CreateSurveyInput = z.infer<typeof createSurveySchema>;
