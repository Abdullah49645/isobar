import type { Counterfactual, TradeoffPoint } from "../models/counterfactual.js";

/**
 * Build tradeoff points from a set of counterfactuals, marking which are
 * Pareto-non-dominated (lower operational cost AND higher contrail benefit
 * than every dominated alternative) and which single point is the
 * "high-leverage" knee.
 *
 * We deliberately do NOT call anything "optimal" (spec section 21: "Do not
 * call one mathematically best without a user-defined objective") - the
 * knee point is a transparent geometric heuristic, labeled as such.
 */
export function buildTradeoffPoints(counterfactuals: Counterfactual[]): TradeoffPoint[] {
  const points: TradeoffPoint[] = counterfactuals.map((cf) => ({
    counterfactualId: cf.id,
    operationalCost: Math.abs(cf.estimatedFuelDeltaKg),
    contrailBenefit: cf.impactReduction,
    uncertainty: cf.uncertainty.level,
    strategy: cf.strategy,
    isNonDominated: false,
    isKneePoint: false,
  }));

  markNonDominated(points);
  markKneePoint(points);
  return points;
}

function markNonDominated(points: TradeoffPoint[]): void {
  for (const p of points) {
    p.isNonDominated = !points.some(
      (other) =>
        other !== p &&
        other.operationalCost <= p.operationalCost &&
        other.contrailBenefit >= p.contrailBenefit &&
        (other.operationalCost < p.operationalCost || other.contrailBenefit > p.contrailBenefit),
    );
  }
}

/**
 * Knee-point heuristic: among non-dominated points, normalize both axes to
 * [0,1] and find the point maximizing (benefit - cost) - i.e. the point
 * farthest above the straight line connecting the cheapest and the most
 * effective non-dominated alternatives. This is the standard geometric
 * definition of a Pareto-frontier "knee" and is fully transparent/explained
 * to the user (spec section 22), not presented as a proof of optimality.
 */
function markKneePoint(points: TradeoffPoint[]): void {
  const frontier = points.filter((p) => p.isNonDominated);
  if (frontier.length === 0) return;
  if (frontier.length === 1) {
    frontier[0]!.isKneePoint = true;
    return;
  }

  const costs = frontier.map((p) => p.operationalCost);
  const benefits = frontier.map((p) => p.contrailBenefit);
  const minCost = Math.min(...costs);
  const maxCost = Math.max(...costs);
  const minBenefit = Math.min(...benefits);
  const maxBenefit = Math.max(...benefits);

  const costRange = maxCost - minCost || 1;
  const benefitRange = maxBenefit - minBenefit || 1;

  let best: TradeoffPoint | null = null;
  let bestScore = -Infinity;
  for (const p of frontier) {
    const normCost = (p.operationalCost - minCost) / costRange;
    const normBenefit = (p.contrailBenefit - minBenefit) / benefitRange;
    const score = normBenefit - normCost;
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  if (best) best.isKneePoint = true;
}
