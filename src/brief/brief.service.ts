import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { EmailService } from '../email/email.service';
import { ZohoService } from '../zoho/zoho.service';
import { CreateBriefDto } from './dto/create-brief.dto';
import { ALLOWED_FILE_TYPES } from './brief.options';

const SEND_FAILED =
  "We couldn't send your brief just now. Please try again in a moment, or message us on WhatsApp.";

/**
 * Handles "Start a project" briefs: checks them, then records each one as a
 * Lead in Zoho CRM. Zoho's workflow rules send the team alert and the client's
 * confirmation email, so this service sends no email itself.
 */
@Injectable()
export class BriefService {
  private readonly logger = new Logger(BriefService.name);

  constructor(
    private readonly emailService: EmailService,
    private readonly zohoService: ZohoService,
  ) {}

  async submit(
    brief: CreateBriefDto,
    file: Express.Multer.File | undefined,
    ip: string,
  ) {
    this.checkContactDetails(brief);
    this.checkFile(file);
    await this.emailService.verifyCaptcha(brief.captchaToken, ip);

    if (!this.zohoService.enabled) {
      this.logger.error(
        'Zoho CRM is not set up (ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN)',
      );
      this.logLostBrief(brief, file);
      throw new InternalServerErrorException([SEND_FAILED]);
    }

    try {
      const leadId = await this.zohoService.createLead({
        services: brief.services,
        goal: brief.goal,
        existing: brief.existing,
        timeline: brief.timeline,
        name: brief.name,
        company: brief.company,
        email: brief.email,
        phone: brief.phone,
        channel: brief.channel,
        pageUri: brief.pageUri,
        file: file
          ? {
              name: file.originalname,
              buffer: file.buffer,
              mimetype: file.mimetype,
            }
          : undefined,
      });
      this.logger.log(`Brief recorded as Zoho CRM lead ${leadId}`);
    } catch (error) {
      // Zoho is the only place a brief is kept, so the visitor is told to try
      // again, and the brief is logged so it can be added by hand if needed.
      this.logger.error('Saving the brief to Zoho CRM failed', error);
      this.logLostBrief(brief, file);
      throw new InternalServerErrorException([SEND_FAILED]);
    }
  }

  private logLostBrief(
    brief: CreateBriefDto,
    file: Express.Multer.File | undefined,
  ) {
    const details = { ...brief, captchaToken: undefined };
    this.logger.error(
      `Brief not saved to Zoho CRM; add it by hand: ${JSON.stringify({ ...details, attachment: file?.originalname ?? null })}`,
    );
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
}
