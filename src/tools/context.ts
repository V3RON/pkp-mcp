import type { PdpClient } from '../api/client.ts'
import type { Places } from '../data/places.ts'
import type { LocaleResolver } from '../i18n/resolver.ts'

/** Shared services handed to every tool. */
export interface Context {
  client: PdpClient
  places: Places
  locale: LocaleResolver
}
