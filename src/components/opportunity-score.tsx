import type { OpportunityScore } from "@/domain/scoring";

function signedWeight(weight: number): string {
  if (weight > 0) {
    return `+${weight}`;
  }
  if (weight < 0) {
    return `−${Math.abs(weight)}`;
  }
  return "0";
}

export function OpportunityScoreCard({
  score,
}: {
  score: OpportunityScore;
}) {
  return (
    <section
      aria-describedby="opportunity-score-help"
      aria-labelledby="opportunity-score-heading"
      className="card opportunity-score"
    >
      <div className="opportunity-score__heading">
        <div>
          <p className="eyebrow">Deterministic ranking</p>
          <h2 id="opportunity-score-heading">Priority score</h2>
        </div>
        <strong className="tnum opportunity-score__total">{score.score}</strong>
      </div>
      <p className="settings-help" id="opportunity-score-help">
        Only the terms below fired. Target status, role text or a New Grad tag,
        a Preferred Location tag, a received referral, posting date, and an
        explicit experience shortfall are the inputs.
      </p>
      {score.terms.length === 0 ? (
        <p className="section-empty">No scoring terms fire for this opportunity.</p>
      ) : (
        <ul aria-label="Priority score terms" className="opportunity-score__terms">
          {score.terms.map((term) => (
            <li key={term.key}>
              <span>{term.label}</span>
              <span className="tnum">{signedWeight(term.weight)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
