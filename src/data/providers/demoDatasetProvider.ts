import type { AtmosphericSample, TrajectoryPoint } from "../../models/flight.js";
import type { ContrailProvider } from "../contrailProvider.js";
import { SyntheticAtmosphericField, defaultNorthAtlanticPatches } from "../../science/atmosphericField.js";
import { haversineMeters } from "../../utils/geo.js";

/**
 * The mandatory offline demo provider (spec sections 7 & 40): no API key, no
 * network, no external database. Always available. Backed by the synthetic
 * atmospheric field in src/science/atmosphericField.ts.
 *
 * Because this provider can answer a query at ANY (lat, lon, altitude, time)
 * - not just the points of one specific recorded flight - it can also
 * atmosphere-sample counterfactual trajectories that fly at different
 * altitudes than the original, which is essential: the whole point of the
 * counterfactual engine is to ask "what would this flight have encountered
 * 2,000 ft lower," and that only works if the provider isn't limited to
 * re-serving a fixed lookup table keyed on the original path.
 */
export class DemoDatasetProvider implements ContrailProvider {
  readonly id = "demo-dataset" as const;
  private readonly field: SyntheticAtmosphericField;

  constructor(referenceTime: string) {
    this.field = new SyntheticAtmosphericField(defaultNorthAtlanticPatches(referenceTime));
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async sampleTrajectory(points: TrajectoryPoint[]): Promise<Array<AtmosphericSample | null>> {
    return points.map((point, i) => {
      const raw = this.field.sample(point.latitude, point.longitude, point.altitudeFt, point.timestamp);

      // Energy forcing is defined per-segment (this waypoint -> the next).
      // Use distance to the next point to convert the field's per-meter
      // figure into a segment total, matching the real API's convention:
      // https://apidocs.contrails.org/ef-interpretation.html
      let segmentEnergyForcingJ: number | null = null;
      if (raw.segmentEnergyForcingJ !== null) {
        const next = points[i + 1];
        const segmentLengthM = next
          ? haversineMeters(point.latitude, point.longitude, next.latitude, next.longitude)
          : 0;
        segmentEnergyForcingJ = raw.segmentEnergyForcingJ * segmentLengthM;
      }

      const sample: AtmosphericSample = {
        ...raw,
        segmentEnergyForcingJ,
        providerId: this.id,
      };
      return sample;
    });
  }
}
