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
