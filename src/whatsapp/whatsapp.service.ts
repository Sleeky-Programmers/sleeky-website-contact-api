import { Injectable, Logger } from '@nestjs/common';
import { normalisePhone, whatsappDigits } from '../brief/phone';

// WhatsApp Business Platform (Meta Cloud API): template messages from a
// separate sender number to Sleeky's own team, never to clients.
// https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-message-templates

const GRAPH = 'https://graph.facebook.com/v21.0';
/** Sleeky's main WhatsApp Business number (the one on the website). */
const DEFAULT_BUSINESS_NUMBER = '2349160952000';

export type TeamAlert = {
  name: string;
  /** "Email" or "Phone call" */
  channel: string;
  /** How to reach them: email and/or phone */
  contact: string;
  services: string;
  timeline: string;
  fileUrl?: string;
};

export class WhatsAppError extends Error {}

/** Template parameters may not contain new lines, tabs or more than 4 spaces in a row. */
export const templateText = (value: string, max = 200) =>
  value
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim()
    .slice(0, max) || '-';

/** Comma-separated numbers from settings, as WhatsApp digits; invalid ones are left out. */
export function parseNumbers(list: string | undefined): string[] {
  return [
    ...new Set(
      (list ?? '')
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map(
          (entry) =>
            normalisePhone(entry.startsWith('+') ? entry : `+${entry}`) ??
            normalisePhone(entry),
        )
        .filter((number): number is string => number !== null)
        .map(whatsappDigits),
    ),
  ];
}

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);
  private senderChecked?: Promise<void>;

  private get phoneNumberId() {
    return process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  }

  private get token() {
    return process.env.WHATSAPP_ACCESS_TOKEN?.trim();
  }

  get teamNumbers() {
    return parseNumbers(process.env.WHATSAPP_TEAM_NUMBERS);
  }

  get businessNumber() {
    return (
      parseNumbers(process.env.WHATSAPP_BUSINESS_NUMBER)[0] ??
      DEFAULT_BUSINESS_NUMBER
    );
  }

  get enabled() {
    return Boolean(this.phoneNumberId && this.token && this.teamNumbers.length);
  }

  /**
   * Sends the new-brief template to every team number (and the main business
   * number too when asked). Returns how many were sent; failures are logged.
   */
  async alertTeam(
    alert: TeamAlert,
    options: { includeBusinessNumber?: boolean } = {},
  ): Promise<number> {
    await this.checkSender();

    const recipients = [
      ...new Set([
        ...this.teamNumbers,
        ...(options.includeBusinessNumber ? [this.businessNumber] : []),
      ]),
    ];
    const parameters = [
      alert.name,
      alert.channel,
      alert.contact,
      alert.services,
      alert.timeline,
      alert.fileUrl ?? 'No file attached',
    ].map((text) => ({
      type: 'text',
      text: templateText(text, text === alert.fileUrl ? 1000 : 200),
    }));

    const results = await Promise.allSettled(
      recipients.map((to) =>
        this.graph(`/${this.phoneNumberId}/messages`, {
          messaging_product: 'whatsapp',
          to,
          type: 'template',
          template: {
            name:
              process.env.WHATSAPP_TEMPLATE_NAME?.trim() || 'new_website_brief',
            language: {
              code: process.env.WHATSAPP_TEMPLATE_LANGUAGE?.trim() || 'en',
            },
            components: [{ type: 'body', parameters }],
          },
        }),
      ),
    );
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        this.logger.error(
          `WhatsApp alert to …${recipients[index].slice(-4)} failed: ${result.reason instanceof Error ? result.reason.message : result.reason}`,
        );
      }
    });
    return results.filter((result) => result.status === 'fulfilled').length;
  }

  /** Refuses to send from the main business number (alerts come from a separate number). */
  private checkSender() {
    if (!this.senderChecked) {
      this.senderChecked = this.graph<{ display_phone_number?: string }>(
        `/${this.phoneNumberId}?fields=display_phone_number`,
      )
        .then((sender) => {
          if (
            whatsappDigits(sender.display_phone_number ?? '') ===
            this.businessNumber
          ) {
            throw new WhatsAppError(
              'WHATSAPP_PHONE_NUMBER_ID is the main WhatsApp Business number; team alerts must come from a separate number.',
            );
          }
        })
        .catch((error) => {
          this.senderChecked = undefined;
          throw error;
        });
    }
    return this.senderChecked;
  }

  private async graph<T>(path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${GRAPH}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = (await response.json().catch(() => ({}))) as {
      error?: { message?: string; code?: number };
    };
    if (!response.ok) {
      throw new WhatsAppError(
        `WhatsApp API ${response.status}: ${data.error?.message ?? 'request failed'}`,
      );
    }
    return data as T;
  }
}
