import type { AircraftModel } from "./flight.js";

/**
 * Aircraft-class reference figures. These are NOT certified performance
 * data - we don't have access to a manufacturer's flight planning tables.
 * Cruise fuel-flow figures are order-of-magnitude values commonly cited in
 * public airline-operations and aviation-press sources for these types at
 * typical long-haul cruise weight (e.g. ~5,300-6,000 kg/h for a 787-9,
 * ~2,300-2,600 kg/h for an A320 family aircraft). Treat every downstream
 * number derived from these as an ESTIMATE, never as dispatch-grade fuel
 * planning (spec sections 16-17, 61).
 */
export const AIRCRAFT_CATALOG: Record<string, AircraftModel> = {
  B789: {
    icaoType: "B789",
    displayName: "Boeing 787-9",
    aircraftClass: "widebody",
    referenceMassKg: 254000,
    typicalCruiseMassKg: 190000,
    typicalCruiseTasKts: 488,
    source: "public-documentation",
  },
  A20N: {
    icaoType: "A20N",
    displayName: "Airbus A320neo",
    aircraftClass: "narrowbody",
    referenceMassKg: 79000,
    typicalCruiseMassKg: 68000,
    typicalCruiseTasKts: 447,
    source: "public-documentation",
  },
  E190: {
    icaoType: "E190",
    displayName: "Embraer E190",
    aircraftClass: "regional",
    referenceMassKg: 51800,
    typicalCruiseMassKg: 42000,
    typicalCruiseTasKts: 420,
    source: "public-documentation",
  },
};

/** Approximate typical cruise fuel flow, kg/hour, by aircraft class - see module doc. */
export const TYPICAL_CRUISE_FUEL_FLOW_KG_PER_HOUR: Record<AircraftModel["aircraftClass"], number> = {
  widebody: 5600,
  narrowbody: 2450,
  regional: 1500,
};

/** Standard, widely-documented CO2 emission factor for jet kerosene combustion. */
export const JET_FUEL_CO2_FACTOR_KG_PER_KG = 3.16;
