import { Injectable, Logger } from '@nestjs/common';
import { normalisePhone, whatsappDigits } from '../brief/phone';

// WhatsApp alert for email and phone-call briefs, sent to Sleeky's existing
// WhatsApp number through CallMeBot (https://www.callmebot.com/blog/free-api-whatsapp-messages/).
// No Meta Business account is involved: the receiving number activates
// CallMeBot once and gets an API key; alerts then arrive from CallMeBot's number.

const CALLMEBOT = 'https://api.callmebot.com/whatsapp.php';
/** Sleeky's WhatsApp number (the one on the website). */
const DEFAULT_ALERT_NUMBER = '2349160952000';
/** CallMeBot messages are capped; long goals are trimmed in the alert (the full brief is in Zoho). */
const MAX_LENGTH = 1500;

export type BriefAlert = {
  name: string;
  /** "Email" or "Phone call" */
  channel: string;
  /** How to reach them: phone and/or email */
  contact: string;
  services: string;
  timeline: string;
  goal: string;
  fileUrl?: string;
};

export class WhatsAppError extends Error {}

/** The WhatsApp alert text. */
export function alertMessage(alert: BriefAlert): string {
  const goal =
    alert.goal.length > 400
      ? `${alert.goal.slice(0, 400).trimEnd()}…`
      : alert.goal;
  return [
    '*New project brief from the website*',
    '',
    `Name: ${alert.name}`,
    `Reply by: ${alert.channel}`,
    `Contact: ${alert.contact}`,
    `Services: ${alert.services}`,
    `Timeline: ${alert.timeline}`,
    ...(alert.fileUrl ? [`File: ${alert.fileUrl}`] : []),
    '',
    `Goal: ${goal}`,
    '',
    'The full brief is in Zoho CRM.',
  ]
    .join('\n')
    .slice(0, MAX_LENGTH);
}

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);

  private get apiKey() {
    return process.env.CALLMEBOT_API_KEY?.trim();
  }

  /** The number alerts go to: WHATSAPP_ALERT_NUMBER, or Sleeky's main number. */
  get alertNumber() {
    const configured = process.env.WHATSAPP_ALERT_NUMBER?.trim();
    const normalised = configured
      ? (normalisePhone(
          configured.startsWith('+') ? configured : `+${configured}`,
        ) ?? normalisePhone(configured))
      : null;
    return normalised ? whatsappDigits(normalised) : DEFAULT_ALERT_NUMBER;
  }

  get enabled() {
    return Boolean(this.apiKey);
  }

  /** Sends the brief alert to Sleeky's WhatsApp number. Throws if CallMeBot refuses it. */
  async alert(brief: BriefAlert): Promise<void> {
    const url = new URL(CALLMEBOT);
    url.searchParams.set('phone', `+${this.alertNumber}`);
    url.searchParams.set('text', alertMessage(brief));
    url.searchParams.set('apikey', this.apiKey ?? '');

    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    const body = await response.text();
    // CallMeBot answers with a short HTML page; success says the message was queued or sent.
    if (!response.ok || !/queued|message sent/i.test(body)) {
      const reason = body
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 200);
      throw new WhatsAppError(
        `CallMeBot didn't send the alert (${response.status}): ${reason || 'no details'}`,
      );
    }
  }
}
