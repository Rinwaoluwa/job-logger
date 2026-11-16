import { useCost } from "../hooks/useCost.js";
import { costUsd } from "../lib/format.js";

export default function CostBadge() {
  const { cost } = useCost();
  if (!cost) return null;
  return (
    <span className="cost-badge" title={`Total: ${costUsd(cost.totalUsd)} · This week: ${costUsd(cost.weekUsd)}`}>
      AI today {costUsd(cost.todayUsd)} · {cost.callsToday} call{cost.callsToday === 1 ? "" : "s"}
    </span>
  );
}
