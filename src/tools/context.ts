import type { PdpClient } from '../api/client.ts'
import type { Places } from '../data/places.ts'

/** Shared services handed to every tool. */
export interface Context {
  client: PdpClient
  places: Places
}
