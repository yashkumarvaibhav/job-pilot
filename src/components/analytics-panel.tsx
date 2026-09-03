import { Info } from "lucide-react";

import {
  ANALYTICS_EMPTY,
  type AnalyticsSnapshot,
  type RateDisplay,
} from "@/domain/analytics";

function RateCaption({ rate }: { rate: RateDisplay }) {
  if (!rate.label) {
    return null;
  }

  return (
    <p
      className={
        rate.suppressed ? "analytics-rate analytics-rate--honest" : "analytics-rate"
      }
    >
      {rate.suppressed ? <Info aria-hidden="true" /> : null}
      <span className="tnum">{rate.label}</span>
    </p>
  );
}

export function AnalyticsPanel({ snapshot }: { snapshot: AnalyticsSnapshot }) {
  if (snapshot.empty) {
    return (
      <div className="data-state data-state--empty">
        <p>{ANALYTICS_EMPTY}</p>
      </div>
    );
  }

  return (
    <div className="analytics-figures">
      <section aria-labelledby="analytics-funnel">
        <h2 id="analytics-funnel">Funnel</h2>
        <ol className="funnel">
          {snapshot.funnel.map((step, index) => (
            <li className="funnel-item" key={step.key}>
              {index > 0 ? (
                <span aria-hidden="true" className="funnel-arrow">
                  ↓
                </span>
              ) : null}
              <div className="funnel-step">
                <span className="eyebrow">{step.label}</span>
                <strong className="tnum">{step.count}</strong>
                <RateCaption rate={step.rate} />
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="analytics-slices">
        <h2 id="analytics-slices">Referral vs cold</h2>
        <div className="analytics-compare">
          {snapshot.slices.map((column) => (
            <article className="analytics-compare__column" key={column.key}>
              <h3>{column.label}</h3>
              <p>
                <span className="tnum">{column.applications}</span> applications
              </p>
              <p>
                <span className="tnum">{column.interviews}</span> interviews
              </p>
              <RateCaption rate={column.rate} />
            </article>
          ))}
        </div>
      </section>

      <section aria-labelledby="analytics-channels">
        <h2 id="analytics-channels">Networking by channel</h2>
        {snapshot.channels.length === 0 ? (
          <p className="section-empty">No channel activity yet.</p>
        ) : (
          <>
            <div className="table-scroll channel-table-wrap">
              <table className="tbl channel-table">
                <thead>
                  <tr>
                    <th scope="col">Channel</th>
                    <th scope="col">Attempts</th>
                    <th scope="col">Replies</th>
                    <th scope="col">Referrals</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.channels.map((row) => (
                    <tr key={row.channel}>
                      <td>{row.label}</td>
                      <td className="tnum">{row.attempts}</td>
                      <td className="tnum">{row.replies}</td>
                      <td className="tnum">{row.referrals}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul aria-labelledby="analytics-channels" className="channel-card-list">
              {snapshot.channels.map((row) => (
                <li className="channel-card" key={row.channel}>
                  <strong>{row.label}</strong>
                  <span className="tnum">{row.attempts} attempts</span>
                  <span className="tnum">{row.replies} replies</span>
                  <span className="tnum">{row.referrals} referrals</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
