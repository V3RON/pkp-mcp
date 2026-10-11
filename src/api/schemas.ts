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

/** `/schedules/shortened`: same data with abbreviated keys (much smaller for the whole network). */
const shortStop = z.object({
  id: z.number().int(),
  ord: z.number().int().nullish(),
  atm: z.string().nullish(),
  ady: z.number().int().nullish(),
  apl: z.string().nullish(),
  atr: z.string().nullish(),
  atn: z.string().nullish(),
  acc: z.string().nullish(),
  dtm: z.string().nullish(),
  ddy: z.number().int().nullish(),
  dpl: z.string().nullish(),
  dtr: z.string().nullish(),
  dtn: z.string().nullish(),
  dcc: z.string().nullish(),
  sti: z.number().int().nullish(),
  stn: z.string().nullish(),
})

const shortRoute = z.object({
  sid: z.number().int(),
  oid: z.number().int(),
  toid: z.number().int().nullish(),
  nm: z.string().nullish(),
  cc: z.string().nullish(),
  nn: z.string().nullish(),
  ccs: z.string().nullish(),
  od: z.array(z.string()).nullish(),
  st: z.array(shortStop).nullish(),
})

export const shortSchedulesResponse = z.object({ rt: z.array(shortRoute).nullish() })

/** Maps the shortened response onto the full-name shape so one parser serves both. */
export function expandShortSchedules(body: unknown): SchedulesJson {
  return {
    routes: (shortSchedulesResponse.parse(body).rt ?? []).map((r) => ({
      scheduleId: r.sid,
      orderId: r.oid,
      trainOrderId: r.toid,
      name: r.nm,
      carrierCode: r.cc,
      nationalNumber: r.nn,
      commercialCategorySymbol: r.ccs,
      operatingDates: r.od,
      stations: r.st?.map((s) => ({
        stationId: s.id,
        orderNumber: s.ord,
        arrivalTime: s.atm,
        arrivalDay: s.ady,
        arrivalPlatform: s.apl,
        arrivalTrack: s.atr,
        arrivalTrainNumber: s.atn,
        arrivalCommercialCategory: s.acc,
        departureTime: s.dtm,
        departureDay: s.ddy,
        departurePlatform: s.dpl,
        departureTrack: s.dtr,
        departureTrainNumber: s.dtn,
        departureCommercialCategory: s.dcc,
        stopTypeId: s.sti,
        stopTypeName: s.stn,
      })),
    })),
    dictionaries: null,
  }
}

const operationStation = z.object({
  stationId: z.number().int(),
  plannedSequenceNumber: z.number().int().nullish(),
  actualSequenceNumber: z.number().int().nullish(),
  plannedArrival: z.string().nullish(),
  plannedDeparture: z.string().nullish(),
  arrivalDelayMinutes: z.number().int().nullish(),
  departureDelayMinutes: z.number().int().nullish(),
  actualArrival: z.string().nullish(),
  actualDeparture: z.string().nullish(),
  isConfirmed: z.boolean().nullish(),
  isCancelled: z.boolean().nullish(),
})

export const trainOperation = z.object({
  scheduleId: z.number().int(),
  orderId: z.number().int(),
  trainOrderId: z.number().int().nullish(),
  operatingDate: z.string(),
  trainStatus: z.string().nullish(),
  stations: z.array(operationStation).nullish(),
})

export const operationsResponse = z.object({
  pagination: z.object({ hasNextPage: z.boolean().nullish() }).nullish(),
  trains: z.array(trainOperation).nullish(),
})

export const disruptionsResponse = z.object({
  disruptions: z
    .array(
      z.object({
        disruptionId: z.number(),
        disruptionTypeCode: z.string().nullish(),
        startStationId: z.number().int().nullish(),
        endStationId: z.number().int().nullish(),
        message: z.string().nullish(),
        affectedRoutes: z
          .array(
            z.object({
              scheduleId: z.number().int(),
              orderId: z.number().int(),
              trainOrderId: z.number().int().nullish(),
              operatingDate: z.string(),
              stationId: z.number().int().nullish(),
            }),
          )
          .nullish(),
      }),
    )
    .nullish(),
  disruptionTypes: z.record(z.string(), z.string()).nullish(),
})

export type TrainOperationJson = z.infer<typeof trainOperation>
export type DisruptionsJson = z.infer<typeof disruptionsResponse>
