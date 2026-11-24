import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';

const sesClient = new SESv2Client({});

export interface EmailAttachment {
  fileName: string;
  contentType: string;
  content: string;
}

export interface Email {
  subject: string;
  html: string;
  text: string;
  attachments?: EmailAttachment[];
}

/**
 * Sends one email through Amazon SES. Used by all email templates.
 */
export async function sendEmail(from: string, to: string, email: Email): Promise<void> {
  await sesClient.send(
    new SendEmailCommand({
      FromEmailAddress: from,
      Destination: { ToAddresses: [to] },
      Content: {
        Simple: {
          Subject: { Data: email.subject, Charset: 'UTF-8' },
          Body: {
            Html: { Data: email.html, Charset: 'UTF-8' },
            Text: { Data: email.text, Charset: 'UTF-8' },
          },
          Attachments: email.attachments?.map((attachment) => ({
            FileName: attachment.fileName,
            ContentType: attachment.contentType,
            RawContent: new TextEncoder().encode(attachment.content),
          })),
        },
      },
    })
  );
}

/**
 * Escapes text for use in HTML, so user input (match name, description, ...) cannot add markup.
 */
export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
