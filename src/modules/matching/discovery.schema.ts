import { z } from "zod";

const CoordinateSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  name: z.string().max(200).optional(),
  formattedAddress: z.string().max(500).optional(),
});

export const DiscoverySearchInputSchema = z
  .object({
    origin: CoordinateSchema,
    destination: CoordinateSchema,
    options: z
      .object({
        maxPickupDistanceMeters: z.number().positive().max(5000).optional(),
        maxDestinationDeviationMeters: z.number().positive().max(10000).optional(),
        maxResults: z.number().int().positive().max(50).optional(),
        cursor: z.string().optional(),
      })
      .optional(),
  })
  .strict({
    message: "Unrecognized fields are not permitted in trip discovery",
  });

export type DiscoverySearchInput = z.infer<typeof DiscoverySearchInputSchema>;
