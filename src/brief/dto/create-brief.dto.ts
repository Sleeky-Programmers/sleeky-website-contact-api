import { Transform } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import {
  CHANNEL_LABELS,
  EXISTING_LABELS,
  SERVICE_LABELS,
  TIMELINE_LABELS,
} from '../brief.options';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const emptyToUndefined = ({ value }: { value: unknown }) => {
  const trimmed = typeof value === 'string' ? value.trim() : value;
  return trimmed === '' ? undefined : trimmed;
};

export class CreateBriefDto {
  // Multipart sends a single value as a string and repeated values as an array.
  @Transform(({ value }) =>
    value === undefined ? [] : Array.isArray(value) ? value : [value],
  )
  @IsArray()
  @ArrayNotEmpty({ message: 'Pick at least one service' })
  @IsIn(Object.keys(SERVICE_LABELS), {
    each: true,
    message: 'Unknown service selected',
  })
  services: string[];

  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Tell us what you want to achieve' })
  @MaxLength(5000)
  goal: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsIn(Object.keys(EXISTING_LABELS))
  existing?: string;

  @IsIn(Object.keys(TIMELINE_LABELS), { message: 'Choose a timeline' })
  timeline: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Full name is required' })
  @MaxLength(120)
  name: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(160)
  company?: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsEmail({}, { message: 'Email address must be valid' })
  email?: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @Matches(/^\+?[0-9\s\-()]{7,20}$/, {
    message: 'WhatsApp number must be valid',
  })
  phone?: string;

  @IsIn(Object.keys(CHANNEL_LABELS))
  channel: string;

  @IsString()
  @IsNotEmpty({ message: 'Please complete the captcha' })
  captchaToken: string;

  // HubSpot tracking cookie (hubspotutk) and the page the brief was sent from,
  // so the HubSpot contact is linked to the visitor's page views and source.
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  hutk?: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  pageUri?: string;
}
