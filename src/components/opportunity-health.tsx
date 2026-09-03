import type { OpportunityHealth } from "@/domain/opportunity-health";

export function OpportunityHealthBanner({
  health,
}: {
  health: OpportunityHealth;
}) {
  return (
    <aside className="opportunity-health" data-tone={health.tone} role="status">
      <div className="opportunity-health__heading">
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path
            d="M12 3 2.5 20h19L12 3Zm0 6v5m0 3h.01"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
          />
        </svg>
        <div>
          <h2>{health.title}</h2>
          <p className="tnum">{health.sentence}</p>
        </div>
      </div>
      <ul aria-label="Opportunity health reasons">
        {health.reasons.map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>
    </aside>
  );
}
