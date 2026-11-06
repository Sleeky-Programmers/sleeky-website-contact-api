import { parsePhoneNumberFromString } from 'libphonenumber-js/max';

/** Numbers without a country code are read as Nigerian (e.g. 0803 123 4567). */
export const DEFAULT_COUNTRY = 'NG';

export const INVALID_PHONE_MESSAGE =
  'Enter a valid WhatsApp number, e.g. 0803 123 4567 or +44 7911 123456';

/**
 * A real, dialable number in international format (+2348031234567), or null.
 * Uses full metadata, so made-up numbers of the right length are rejected too.
 */
export function normalisePhone(value: string): string | null {
  const parsed = parsePhoneNumberFromString(value.trim(), DEFAULT_COUNTRY);
  return parsed?.isValid() ? parsed.number : null;
}

/** Digits only, as WhatsApp's APIs and wa.me links want them (2348031234567). */
export const whatsappDigits = (e164: string) => e164.replace(/\D/g, '');
