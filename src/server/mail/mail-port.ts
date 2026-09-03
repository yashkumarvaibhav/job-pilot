export type MailAttachment = {
  id: string;
  filename: string;
  contentType: string;
  bytes: Buffer;
};

export type MailSendRequest = {
  accountId: string;
  refreshToken: string;
  fromEmail: string;
  senderName: string;
  replyTo: string | null;
  to: string[];
  subject: string;
  body: string;
  attachments: MailAttachment[];
  rfcMessageId?: string;
};

export type MailSendResult = {
  gmailMessageId: string;
  gmailThreadId: string;
  rfcMessageId: string;
  sentAt: Date;
};

export interface MailPort {
  send(request: MailSendRequest): Promise<MailSendResult>;
}

export type MailMessageLookupResult =
  | { status: "found"; gmailMessageId: string; gmailThreadId: string }
  | { status: "absent" }
  | { status: "ambiguous" };

export interface QueueMailPort extends MailPort {
  findByRfcMessageId(input: {
    refreshToken: string;
    rfcMessageId: string;
  }): Promise<MailMessageLookupResult>;
}
