import { test } from "node:test";
import assert from "node:assert/strict";
import { greatCircleInterpolate, hashNoise, haversineMeters, isaTemperatureK, pointInGeoJsonGeometry, pointInRing } from "../geo.js";

test("haversineMeters: JFK to LHR is roughly the known great-circle distance (~5540 km)", () => {
  const jfk = { lat: 40.6413, lon: -73.7781 };
  const lhr = { lat: 51.4700, lon: -0.4543 };
  const distM = haversineMeters(jfk.lat, jfk.lon, lhr.lat, lhr.lon);
  const distKm = distM / 1000;
  assert.ok(distKm > 5400 && distKm < 5650, `expected ~5540km, got ${distKm}`);
});

test("greatCircleInterpolate: fraction 0 and 1 return the endpoints", () => {
  const start = greatCircleInterpolate(40.64, -73.78, 51.47, -0.45, 0);
  const end = greatCircleInterpolate(40.64, -73.78, 51.47, -0.45, 1);
  assert.ok(Math.abs(start.latitude - 40.64) < 1e-6);
  assert.ok(Math.abs(start.longitude - -73.78) < 1e-6);
  assert.ok(Math.abs(end.latitude - 51.47) < 1e-6);
  assert.ok(Math.abs(end.longitude - -0.45) < 1e-6);
});

test("greatCircleInterpolate: midpoint lies roughly between endpoints and on the great circle (further north than a straight lat average for this route)", () => {
  const mid = greatCircleInterpolate(40.64, -73.78, 51.47, -0.45, 0.5);
  // Great-circle routes between JFK and LHR bow northward above the simple
  // average of the two latitudes - a classic sanity check for slerp vs lerp.
  const naiveLatAverage = (40.64 + 51.47) / 2;
  assert.ok(mid.latitude > naiveLatAverage, `expected great-circle bow northward, got ${mid.latitude} vs naive ${naiveLatAverage}`);
});

test("isaTemperatureK: sea level is ~288.15K, decreases with altitude, isothermal above tropopause", () => {
  const seaLevel = isaTemperatureK(0);
  const cruise = isaTemperatureK(36000);
  const aboveTropopause = isaTemperatureK(45000);
  const wayAboveTropopause = isaTemperatureK(60000);
  assert.ok(Math.abs(seaLevel - 288.15) < 0.01);
  assert.ok(cruise < seaLevel);
  assert.ok(aboveTropopause < cruise);
  // Above ~36,089 ft (11km) ISA is isothermal - two altitudes above that
  // should report the same temperature.
  assert.equal(aboveTropopause, wayAboveTropopause);
});

test("hashNoise: deterministic for identical inputs, varies across inputs, bounded [0,1)", () => {
  const a = hashNoise(1.23, 4.56, 7.89);
  const b = hashNoise(1.23, 4.56, 7.89);
  const c = hashNoise(1.24, 4.56, 7.89);
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.ok(a >= 0 && a < 1);
});

test("pointInRing: a point at a square's center is inside; a point far outside is not", () => {
  const square: Array<[number, number]> = [
    [-10, -10],
    [10, -10],
    [10, 10],
    [-10, 10],
  ];
  assert.equal(pointInRing(0, 0, square), true);
  assert.equal(pointInRing(50, 50, square), false);
});

test("pointInRing: a point exactly outside a triangle's bounding area is not inside", () => {
  const triangle: Array<[number, number]> = [
    [0, 0],
    [4, 0],
    [0, 4],
  ];
  assert.equal(pointInRing(1, 1, triangle), true);
  assert.equal(pointInRing(3, 3, triangle), false);
});

test("pointInGeoJsonGeometry: Polygon with a hole excludes points inside the hole", () => {
  const outer: Array<[number, number]> = [
    [-10, -10],
    [10, -10],
    [10, 10],
    [-10, 10],
  ];
  const hole: Array<[number, number]> = [
    [-2, -2],
    [2, -2],
    [2, 2],
    [-2, 2],
  ];
  const geometry = { type: "Polygon", coordinates: [outer, hole] };
  assert.equal(pointInGeoJsonGeometry(5, 5, geometry), true, "inside outer ring, outside hole");
  assert.equal(pointInGeoJsonGeometry(0, 0, geometry), false, "inside the hole should be excluded");
  assert.equal(pointInGeoJsonGeometry(50, 50, geometry), false, "outside everything");
});

test("pointInGeoJsonGeometry: MultiPolygon matches if the point is inside any one polygon", () => {
  const squareA: Array<[number, number]> = [[-10, -10], [-5, -10], [-5, -5], [-10, -5]];
  const squareB: Array<[number, number]> = [[5, 5], [10, 5], [10, 10], [5, 10]];
  const geometry = { type: "MultiPolygon", coordinates: [[squareA], [squareB]] };
  assert.equal(pointInGeoJsonGeometry(-7, -7, geometry), true);
  assert.equal(pointInGeoJsonGeometry(7, 7, geometry), true);
  assert.equal(pointInGeoJsonGeometry(0, 0, geometry), false);
});

test("pointInGeoJsonGeometry: unsupported geometry types (e.g. Point) return false rather than throw", () => {
  assert.equal(pointInGeoJsonGeometry(0, 0, { type: "Point", coordinates: [0, 0] }), false);
});
