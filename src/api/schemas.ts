import { z } from 'zod'

/**
 * Lenient parsers for the API responses we use (trust boundary). The generated OpenAPI types in
 * generated.ts mark every field optional, so these schemas decide what we actually require.
 */

export const stationsResponse = z.object({
  stations: z.array(z.object({ id: z.number().int(), name: z.string().nullish() })),
  totalPages: z.number().int().nullish(),
})

export const citiesResponse = z.object({
  cities: z.array(
    z.object({
      name: z.string().nullish(),
      stationIds: z.array(z.number().int()).nullish(),
    }),
  ),
})

export const dataVersionResponse = z.object({
  dataVersion: z.string().nullish(),
  schedulesVersion: z.string().nullish(),
  operationsVersion: z.string().nullish(),
  timestamp: z.string().nullish(),
})
