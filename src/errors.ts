/** An error caused by the request (unknown station, bad date…). Shown to the model as-is, never logged as a failure. */
export class UserError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UserError'
  }
}
