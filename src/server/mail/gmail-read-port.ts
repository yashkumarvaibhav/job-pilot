export type GmailMessageSnapshot = {
  gmailId: string;
  rfcMessageId: string | null;
  fromEmail: string;
  to: string[];
  subject: string;
  body: string;
  deliveryStatusText?: string | null;
  failedRecipients?: string[];
  sentAt: Date;
};

export type GmailThreadSnapshot = {
  gmailThreadId: string;
  historyId: string;
  messages: GmailMessageSnapshot[];
};

type GmailCall = {
  refreshToken: string;
  signal?: AbortSignal;
};

export type GmailReadPort = {
  getProfileHistoryId(input: GmailCall): Promise<string>;
  listHistory(
    input: GmailCall & { startHistoryId: string; pageToken: string | null },
  ): Promise<{
    historyId: string;
    threadIds: string[];
    nextPageToken: string | null;
  }>;
  listThreads(
    input: GmailCall & {
      query: string;
      maxResults: number;
      pageToken: string | null;
    },
  ): Promise<{ threadIds: string[]; nextPageToken: string | null }>;
  getThread(
    input: GmailCall & { gmailThreadId: string },
  ): Promise<GmailThreadSnapshot>;
};

export class GmailHistoryGapError extends Error {
  constructor() {
    super("Gmail history is no longer available from the saved cursor.");
    this.name = "GmailHistoryGapError";
  }
}
