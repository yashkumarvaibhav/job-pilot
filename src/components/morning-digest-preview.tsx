import {
  DIGEST_PREVIEW_EMPTY,
  DIGEST_PREVIEW_TITLE,
  type DigestCounts,
} from "@/domain/digest";

const LINES: Array<{ key: keyof DigestCounts; singular: string; plural: string }> =
  [
    { key: "followUps", singular: "follow-up due", plural: "follow-ups due" },
    { key: "deadlines", singular: "deadline", plural: "deadlines" },
    { key: "oa", singular: "OA", plural: "OA" },
    {
      key: "replies",
      singular: "recruiter reply awaiting action",
      plural: "recruiter replies awaiting action",
    },
    {
      key: "interviewsToday",
      singular: "interview today",
      plural: "interviews today",
    },
  ];

export function MorningDigestPreview({
  asOfOn,
  body,
  counts,
  timeZone,
}: {
  asOfOn: string;
  body: string;
  counts: DigestCounts;
  timeZone: string;
}) {
  const empty =
    counts.followUps +
      counts.deadlines +
      counts.oa +
      counts.replies +
      counts.interviewsToday ===
    0;

  return (
    <section aria-labelledby="digest-preview-title" className="settings-section">
      <h2 id="digest-preview-title">{DIGEST_PREVIEW_TITLE}</h2>
      <p className="settings-help">
        Counts for {asOfOn} in {timeZone}. These match Today.
      </p>
      {empty ? <p className="settings-hint">{DIGEST_PREVIEW_EMPTY}</p> : null}
      <ol className="digest-preview-list">
        {LINES.map((line) => {
          const count = counts[line.key];
          return (
            <li key={line.key}>
              <span className="tnum">{count}</span>{" "}
              {count === 1 ? line.singular : line.plural}
            </li>
          );
        })}
      </ol>
      <pre className="digest-preview-body">{body}</pre>
    </section>
  );
}
