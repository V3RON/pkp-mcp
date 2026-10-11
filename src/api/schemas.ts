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

const stopOnRoute = z.object({
  stationId: z.number().int(),
  orderNumber: z.number().int().nullish(),
  arrivalTime: z.string().nullish(),
  arrivalDay: z.number().int().nullish(),
  arrivalPlatform: z.string().nullish(),
  arrivalTrack: z.string().nullish(),
  arrivalTrainNumber: z.string().nullish(),
  arrivalCommercialCategory: z.string().nullish(),
  departureTime: z.string().nullish(),
  departureDay: z.number().int().nullish(),
  departurePlatform: z.string().nullish(),
  departureTrack: z.string().nullish(),
  departureTrainNumber: z.string().nullish(),
  departureCommercialCategory: z.string().nullish(),
  stopTypeId: z.number().int().nullish(),
  stopTypeName: z.string().nullish(),
})

export const route = z.object({
  scheduleId: z.number().int(),
  orderId: z.number().int(),
  trainOrderId: z.number().int().nullish(),
  name: z.string().nullish(),
  carrierCode: z.string().nullish(),
  nationalNumber: z.string().nullish(),
  commercialCategorySymbol: z.string().nullish(),
  operatingDates: z.array(z.string()).nullish(),
  stations: z.array(stopOnRoute).nullish(),
})

export const schedulesResponse = z.object({
  routes: z.array(route).nullish(),
  dictionaries: z
    .object({
      stations: z
        .record(z.string(), z.object({ id: z.number().int().nullish(), name: z.string().nullish() }))
        .nullish(),
      carriers: z.record(z.string(), z.string()).nullish(),
      commercialCategories: z.record(z.string(), z.string()).nullish(),
      stopTypes: z.record(z.string(), z.string()).nullish(),
    })
    .nullish(),
})

export type RouteJson = z.infer<typeof route>
export type SchedulesJson = z.infer<typeof schedulesResponse>
