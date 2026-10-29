import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { EmailService } from '../email/email.service';
import { HubspotService } from '../hubspot/hubspot.service';
import { CreateBriefDto } from './dto/create-brief.dto';
import {
  ALLOWED_FILE_TYPES,
  CHANNEL_LABELS,
  EXISTING_LABELS,
  SERVICE_LABELS,
  TIMELINE_LABELS,
} from './brief.options';

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const multiline = (value: string) =>
  escapeHtml(value).replace(/\r?\n/g, '<br>');

type HubspotOutcome =
  | { status: 'disabled' | 'failed' }
  | { status: 'synced'; dealUrl?: string };

@Injectable()
export class BriefService {
  private readonly logger = new Logger(BriefService.name);

  constructor(
    private readonly emailService: EmailService,
    private readonly hubspotService: HubspotService,
  ) {}

  async submit(
    brief: CreateBriefDto,
    file: Express.Multer.File | undefined,
    ip: string,
  ) {
    this.checkContactDetails(brief);
    this.checkFile(file);
    await this.emailService.verifyCaptcha(brief.captchaToken, ip);

    if (!process.env.EMAIL_ADDRESS) {
      this.logger.error('EMAIL_ADDRESS environment variable is not set');
      throw new InternalServerErrorException([
        'Unable to send your brief right now, please try again later',
      ]);
    }

    const hubspot = await this.syncToHubspot(brief, file, ip);
    await this.sendTeamEmail(brief, file, hubspot);

    if (brief.email) {
      try {
        await this.sendConfirmationEmail(brief);
      } catch (error) {
        // The brief reached the team; a failed confirmation shouldn't fail the request.
        this.logger.error('Brief confirmation email failed', error);
      }
    }
  }

  /**
   * Records the brief in HubSpot (brief 4.2). A HubSpot failure never loses the
   * lead: it is logged and flagged in the team email, which carries the full brief.
   */
  private async syncToHubspot(
    brief: CreateBriefDto,
    file: Express.Multer.File | undefined,
    ip: string,
  ): Promise<HubspotOutcome> {
    if (!this.hubspotService.enabled) return { status: 'disabled' };
    try {
      const result = await this.hubspotService.syncBrief({
        ...brief,
        ip,
        file: file
          ? {
              name: file.originalname,
              buffer: file.buffer,
              mimetype: file.mimetype,
            }
          : undefined,
      });
      return { status: 'synced', dealUrl: result.dealUrl };
    } catch (error) {
      this.logger.error('HubSpot sync failed', error);
      return { status: 'failed' };
    }
  }

  private checkContactDetails(brief: CreateBriefDto) {
    if (!brief.email && !brief.phone) {
      throw new BadRequestException([
        'Add an email address or WhatsApp number so we can reply',
      ]);
    }
    if (brief.channel === 'email' && !brief.email) {
      throw new BadRequestException([
        'Add your email, since you would like us to reply by email',
      ]);
    }
    if (brief.channel !== 'email' && !brief.phone) {
      throw new BadRequestException([
        'Add your WhatsApp number, since you would like us to reply by WhatsApp or phone',
      ]);
    }
  }

  private checkFile(file: Express.Multer.File | undefined) {
    if (!file) return;
    const extension = file.originalname.split('.').pop()?.toLowerCase() ?? '';
    const allowed = ALLOWED_FILE_TYPES[file.mimetype];
    if (!allowed || !allowed.includes(extension)) {
      throw new BadRequestException([
        'Attach a PDF, Word document or image (PNG or JPG)',
      ]);
    }
  }

  private sendTeamEmail(
    brief: CreateBriefDto,
    file: Express.Multer.File | undefined,
    hubspot: HubspotOutcome,
  ) {
    const services = brief.services.map((id) => SERVICE_LABELS[id]);
    const rows: [string, string][] = [
      ['Name', brief.name],
      ['Company', brief.company ?? '—'],
      ['Email', brief.email ?? '—'],
      ['WhatsApp number', brief.phone ?? '—'],
      ['Preferred channel', CHANNEL_LABELS[brief.channel]],
      ['Services', services.join(', ')],
      ['Timeline', TIMELINE_LABELS[brief.timeline]],
      [
        'Existing site or app',
        brief.existing ? EXISTING_LABELS[brief.existing] : 'Not answered',
      ],
      ['Attachment', file ? file.originalname : 'None'],
    ];

    const tableRows = rows
      .map(
        ([label, value]) =>
          `<tr><td style="padding:8px 16px 8px 0;color:#5F6E7C;white-space:nowrap;vertical-align:top">${label}</td><td style="padding:8px 0;color:#070B10">${escapeHtml(value)}</td></tr>`,
      )
      .join('');

    const subjectName = brief.company
      ? `${brief.name} (${brief.company})`
      : brief.name;

    const hubspotNote =
      hubspot.status === 'synced' && hubspot.dealUrl
        ? `<p style="margin:0 0 24px"><a href="${escapeHtml(hubspot.dealUrl)}" style="display:inline-block;background:#58D68D;color:#070B10;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:999px">Open the deal in HubSpot</a></p>`
        : hubspot.status === 'failed'
          ? `<p style="margin:0 0 24px;padding:12px 16px;background:#FFF4E5;border-radius:10px;color:#7A4B00">This brief could not be added to HubSpot automatically. Please add the contact and deal by hand.</p>`
          : '';

    return this.emailService.send({
      from: `"Sleeky Website" <${process.env.EMAIL_USERNAME}>`,
      to: process.env.EMAIL_ADDRESS,
      replyTo: brief.email,
      subject: `New project brief: ${subjectName} — ${services.join(', ')}`,
      html: this.layout(
        'New project brief',
        `${hubspotNote}<table style="border-collapse:collapse;font-size:15px;line-height:1.5">${tableRows}</table>
         <h2 style="font-size:16px;margin:28px 0 8px;color:#070B10">What they want to achieve</h2>
         <p style="margin:0;font-size:15px;line-height:1.6;color:#070B10">${multiline(brief.goal)}</p>`,
        'This brief was sent from the Start a project form on your website.',
      ),
      attachments: file
        ? [
            {
              filename: file.originalname,
              content: file.buffer,
              contentType: file.mimetype,
            },
          ]
        : undefined,
    });
  }

  private sendConfirmationEmail(brief: CreateBriefDto) {
    const firstName = brief.name.split(/\s+/)[0];
    const channel = CHANNEL_LABELS[brief.channel].toLowerCase();

    return this.emailService.send({
      from: `"Sleeky Programmers" <${process.env.EMAIL_USERNAME}>`,
      to: brief.email,
      replyTo: process.env.EMAIL_ADDRESS,
      subject: "We've received your project brief",
      html: this.layout(
        `Got it, ${escapeHtml(firstName)} — we're on it.`,
        `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#070B10">Thanks for telling us about your project. A Sleeky specialist will review your brief and reach out by ${escapeHtml(channel)} within 24 hours to book a short discovery call.</p>
         <p style="margin:0;font-size:16px;line-height:1.6;color:#070B10">Can't wait? Message us on WhatsApp at <a href="https://wa.me/2349160952000" style="color:#1E8A4F">0916 095 2000</a>.</p>`,
        'You received this email because you sent a project brief on sleekyprogrammers.com.',
      ),
    });
  }

  private layout(heading: string, body: string, footer: string) {
    return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${heading}</title></head>
<body style="margin:0;padding:24px 12px;background:#F4F6F8;font-family:Arial,Helvetica,sans-serif">
  <div style="max-width:600px;margin:0 auto;background:#FFFFFF;border-radius:16px;overflow:hidden">
    <div style="background:#070B10;padding:28px 32px;border-bottom:3px solid #58D68D">
      <div style="font-size:22px;font-weight:bold;color:#FFFFFF">Sleeky <span style="color:#58D68D">Programmers</span></div>
    </div>
    <div style="padding:32px">
      <h1 style="margin:0 0 20px;font-size:24px;line-height:1.25;color:#070B10">${heading}</h1>
      ${body}
    </div>
    <div style="padding:20px 32px;background:#F4F6F8;font-size:13px;line-height:1.5;color:#5F6E7C">
      <p style="margin:0 0 6px">${footer}</p>
      <p style="margin:0">&copy; ${new Date().getFullYear()} Sleeky Programmers Ltd · 20 Olanrewaju Street, Akoka, Lagos</p>
    </div>
  </div>
</body>
</html>`;
  }
}
