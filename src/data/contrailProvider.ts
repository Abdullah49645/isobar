import type { AtmosphericSample, TrajectoryPoint } from "../models/flight.js";

/**
 * Abstraction over "give me atmospheric/contrail conditions for these
 * trajectory points." The frontend and science layer depend only on this
 * interface and on AtmosphericSample - never on a provider's raw response
 * schema. This lets us swap DemoDatasetProvider for a live provider without
 * touching anything upstream.
 */
export interface ContrailProvider {
  readonly id: AtmosphericSample["providerId"];

  /**
   * Sample atmospheric/contrail conditions at each given trajectory point.
   * Must return exactly one result per input point, in the same order.
   * A null entry means "no data available for this point" - callers must
   * handle that explicitly rather than assuming data always exists
   * (see docs/failure-states.md and the spec's "do not invent values" rule).
   */
  sampleTrajectory(points: TrajectoryPoint[]): Promise<Array<AtmosphericSample | null>>;

  /** Whether this provider is currently reachable/configured. */
  isAvailable(): Promise<boolean>;
}

export class ProviderUnavailableError extends Error {
  constructor(providerId: string, reason: string) {
    super(`Contrail provider "${providerId}" is unavailable: ${reason}`);
    this.name = "ProviderUnavailableError";
  }
}
