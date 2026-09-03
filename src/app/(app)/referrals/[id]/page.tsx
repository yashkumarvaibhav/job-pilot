import Link from "next/link";

import { InteractionChannelMark } from "@/components/interaction-channel";
import { ReferralEditForm } from "@/components/referral-forms";
import { ReferralStageChip } from "@/components/referral-status";
import { StaleFlag } from "@/components/stale-chip";
import { ActivityTimeline } from "@/components/activity-timeline";
import {
  formatInteractionOccurredAt,
  interactionChannelLabel,
  interactionDirectionLabel,
} from "@/domain/interaction";
import { calendarDateInZone } from "@/domain/referral";
import { requireTenant } from "@/server/auth/current-session";
import { getWorkspaceSettings } from "@/server/db/foundation";
import { getDatabase } from "@/server/db/runtime";
import { DEFAULT_TIME_ZONE } from "@/server/db/timezone";
import { listContacts } from "@/server/repos/contacts";
import { listInteractions } from "@/server/repos/interactions";
import { listOpportunities } from "@/server/repos/opportunities";
import { getReferral } from "@/server/repos/referrals";
import { listActivity } from "@/server/repos/activity";
import { listStaleIndex } from "@/server/repos/rules";

type Props = { params: Promise<{ id: string }> };

export default async function ReferralDetailPage({ params }: Props) {
  const tenant = await requireTenant();
  const database = getDatabase();
  const { id } = await params;
  const row = getReferral(database, tenant, id);
  if (!row) {
    return (
      <section className="data-state data-state--error referral-not-found">
        <p className="eyebrow">Not found</p>
        <h1>Referral not found</h1>
        <p>This referral does not exist in your workspace.</p>
        <Link className="btn btn--ghost" href="/referrals">
          Back to referrals
        </Link>
      </section>
    );
  }

  const timeZone =
    getWorkspaceSettings(database, tenant, tenant.workspaceId)?.timezone ??
    DEFAULT_TIME_ZONE;
  const staleReasons =
    listStaleIndex(
      database,
      tenant,
      calendarDateInZone(timeZone),
    ).referral.get(row.id) ?? [];
  const contacts = listContacts(database, tenant).map(({ id: contactId, name }) => ({
    id: contactId,
    name,
  }));
  const opportunities = listOpportunities(database, tenant, "all").map(
    (item) => ({
      id: item.id,
      role: item.role,
      companyName: item.companyName,
    }),
  );
  const interactions = listInteractions(database, tenant, {
    referralId: row.id,
  });
  const activity = listActivity(database, tenant, {
    timeZone,
    entityType: "referral_request",
    entityId: row.id,
  });

  return (
    <article className="referral-detail">
      <Link className="back-link" href="/referrals">
        <span aria-hidden="true">←</span> Referrals
      </Link>
      <header className="detail-header">
        <div>
          <p className="eyebrow">Referral request</p>
          <h1>{row.contactName}</h1>
          <p className="page-lede">
            <Link className="inline-link" href={`/contacts/${row.contactId}`}>
              {row.contactName}
            </Link>
            {row.opportunityId && row.role ? (
              <>
                {" · "}
                <Link
                  className="inline-link"
                  href={`/opportunities/${row.opportunityId}`}
                >
                  {row.companyName ? `${row.companyName} ${row.role}` : row.role}
                </Link>
              </>
            ) : (
              " · No opportunity yet"
            )}
            {" · "}
            {interactionChannelLabel(row.channel)}
          </p>
        </div>
        <div className="detail-header__actions">
          <ReferralStageChip stage={row.stage} />
          <StaleFlag reasons={staleReasons} />
          <Link
            className="btn"
            href={`/compose?contactId=${row.contactId}&opportunityId=${row.opportunityId ?? ""}&referralId=${row.id}`}
          >
            Compose email
          </Link>
        </div>
      </header>
      <section aria-labelledby="referral-interactions" className="detail-section">
        <h2 id="referral-interactions">Interactions</h2>
        {interactions.length === 0 ? (
          <p className="section-empty">
            No interactions linked to this referral yet.
          </p>
        ) : (
          <ol className="interaction-timeline">
            {interactions.map((item) => (
              <li key={item.id}>
                <div className="interaction-timeline__meta">
                  <InteractionChannelMark channel={item.channel} />
                  <span className="interaction-direction">
                    {interactionDirectionLabel(item.direction)}
                  </span>
                  <time
                    className="tnum"
                    dateTime={item.occurredAt.toISOString()}
                  >
                    {formatInteractionOccurredAt(item.occurredAt, timeZone)}
                  </time>
                </div>
                {item.body ? <p>{item.body}</p> : null}
              </li>
            ))}
          </ol>
        )}
      </section>
      <section aria-labelledby="referral-activity" className="detail-section">
        <h2 id="referral-activity">Activity</h2>
        <ActivityTimeline
          empty="No activity recorded yet."
          items={activity}
          timeZone={timeZone}
          todayOn={calendarDateInZone(timeZone)}
        />
      </section>
      <section aria-labelledby="edit-referral" className="detail-section">
        <h2 id="edit-referral">Edit referral</h2>
        <ReferralEditForm
          contacts={contacts}
          opportunities={opportunities}
          referral={row}
        />
      </section>
    </article>
  );
}
