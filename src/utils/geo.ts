const EARTH_RADIUS_M = 6371000;

export function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function toDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/** Great-circle distance between two lat/lon points, in meters (haversine). */
export function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
}

/**
 * Interpolate a point along the great-circle path between two coordinates.
 * `fraction` in [0,1], 0 = start, 1 = end. Uses spherical linear
 * interpolation (slerp) on the unit sphere, standard for great-circle
 * intermediate points.
 */
export function greatCircleInterpolate(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
  fraction: number,
): { latitude: number; longitude: number } {
  const phi1 = toRad(lat1);
  const lambda1 = toRad(lon1);
  const phi2 = toRad(lat2);
  const lambda2 = toRad(lon2);

  const dLat = phi2 - phi1;
  const dLon = lambda2 - lambda1;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLon / 2) ** 2;
  const angularDistance = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  if (angularDistance === 0) {
    return { latitude: lat1, longitude: lon1 };
  }

  const A = Math.sin((1 - fraction) * angularDistance) / Math.sin(angularDistance);
  const B = Math.sin(fraction * angularDistance) / Math.sin(angularDistance);

  const x = A * Math.cos(phi1) * Math.cos(lambda1) + B * Math.cos(phi2) * Math.cos(lambda2);
  const y = A * Math.cos(phi1) * Math.sin(lambda1) + B * Math.cos(phi2) * Math.sin(lambda2);
  const z = A * Math.sin(phi1) + B * Math.sin(phi2);

  const phi3 = Math.atan2(z, Math.sqrt(x * x + y * y));
  const lambda3 = Math.atan2(y, x);

  return { latitude: toDeg(phi3), longitude: toDeg(lambda3) };
}

/**
 * International Standard Atmosphere temperature at a given geometric
 * altitude (feet), Kelvin. Valid to ~65,000 ft (well beyond cruise). Standard
 * troposphere lapse rate 6.5 K/km up to the 11 km tropopause, isothermal
 * 216.65 K above that up to ~20 km. This is the textbook ISA model, used
 * here as the baseline ambient temperature before any synthetic
 * weather-system perturbation is layered on top (see atmosphericField.ts).
 */
export function isaTemperatureK(altitudeFt: number): number {
  const altitudeM = altitudeFt * 0.3048;
  const TROPOPAUSE_M = 11000;
  const SEA_LEVEL_TEMP_K = 288.15;
  const LAPSE_RATE_K_PER_M = 0.0065;
  const TROPOPAUSE_TEMP_K = SEA_LEVEL_TEMP_K - LAPSE_RATE_K_PER_M * TROPOPAUSE_M; // 216.65 K

  if (altitudeM <= TROPOPAUSE_M) {
    return SEA_LEVEL_TEMP_K - LAPSE_RATE_K_PER_M * altitudeM;
  }
  return TROPOPAUSE_TEMP_K;
}

/**
 * Ray-casting point-in-polygon test (even-odd rule) for a single GeoJSON-style
 * linear ring: an array of [lng, lat] pairs. Used to test a trajectory point
 * against a Contrails API /v2/regions polygon (see
 * src/data/providers/googleContrailsProvider.ts) without pulling in a full
 * GeoJSON/turf dependency for one predicate.
 */
export function pointInRing(lat: number, lon: number, ring: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const pi = ring[i];
    const pj = ring[j];
    if (!pi || !pj) continue;
    const [xi, yi] = pi;
    const [xj, yj] = pj;
    const intersects =
      yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * Point-in-polygon against a full GeoJSON Polygon or MultiPolygon geometry
 * (first ring of each polygon = outer boundary; subsequent rings = holes,
 * per the GeoJSON spec). Returns true if the point falls inside the shape.
 */
export function pointInGeoJsonGeometry(
  lat: number,
  lon: number,
  geometry: { type: string; coordinates: unknown },
): boolean {
  const testPolygon = (rings: Array<Array<[number, number]>>): boolean => {
    const outer = rings[0];
    if (!rings.length || !outer) return false;
    if (!pointInRing(lat, lon, outer)) return false;
    for (let i = 1; i < rings.length; i++) {
      const hole = rings[i];
      if (hole && pointInRing(lat, lon, hole)) return false; // inside a hole
    }
    return true;
  };

  if (geometry.type === "Polygon") {
    return testPolygon(geometry.coordinates as Array<Array<[number, number]>>);
  }
  if (geometry.type === "MultiPolygon") {
    return (geometry.coordinates as Array<Array<Array<[number, number]>>>).some(testPolygon);
  }
  return false;
}
export function hashNoise(...values: number[]): number {
  let h = 2166136261;
  for (const v of values) {
    // Mix each numeric input through FNV-1a-style avalanching.
    const bits = Math.floor(v * 1000);
    h ^= bits;
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 15;
  h = Math.imul(h, 2246822519);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489917);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
