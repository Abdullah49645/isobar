import type { AtmosphericSample, TrajectoryPoint } from "../../models/flight.js";
import type { ContrailProvider } from "../contrailProvider.js";

/**
 * Wraps another provider and caches results by a stable key (lat/lon rounded
 * + timestamp + altitude bucket). Per spec section 38: "Do not repeatedly
 * request the same API data." This is a simple in-memory cache; a real
 * deployment would back it with the disk/KV cache described in
 * docs/reproducibility.md.
 */
export class CachedContrailsProvider implements ContrailProvider {
  readonly id: ContrailProvider["id"];
  private readonly cache = new Map<string, AtmosphericSample | null>();

  constructor(private readonly inner: ContrailProvider) {
    this.id = inner.id;
  }

  isAvailable(): Promise<boolean> {
    return this.inner.isAvailable();
  }

  async sampleTrajectory(points: TrajectoryPoint[]): Promise<Array<AtmosphericSample | null>> {
    const results: Array<AtmosphericSample | null> = new Array(points.length).fill(null);
    const missingIndices: number[] = [];
    const missingPoints: TrajectoryPoint[] = [];

    points.forEach((p, i) => {
      const key = CachedContrailsProvider.keyFor(p);
      if (this.cache.has(key)) {
        results[i] = this.cache.get(key)!;
      } else {
        missingIndices.push(i);
        missingPoints.push(p);
      }
    });

    if (missingPoints.length > 0) {
      const fetched = await this.inner.sampleTrajectory(missingPoints);
      fetched.forEach((sample, j) => {
        const originalIndex = missingIndices[j]!;
        const key = CachedContrailsProvider.keyFor(points[originalIndex]!);
        this.cache.set(key, sample);
        results[originalIndex] = sample;
      });
    }

    return results;
  }

  private static keyFor(p: TrajectoryPoint): string {
    // Round to a coarser grid than raw floats so nearby, distinct waypoints
    // that map to the same atmospheric grid cell share one cache entry.
    const lat = p.latitude.toFixed(2);
    const lon = p.longitude.toFixed(2);
    const fl = Math.round(p.altitudeFt / 1000) * 1000;
    return `${p.timestamp}|${lat}|${lon}|${fl}`;
  }
}
