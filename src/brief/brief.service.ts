import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import {
  BriefFilesService,
  type StoredBriefFile,
} from '../brief-files/brief-files.service';
import { EmailService } from '../email/email.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { ZohoService } from '../zoho/zoho.service';
import { CreateBriefDto } from './dto/create-brief.dto';
import {
  ALLOWED_FILE_TYPES,
  CHANNEL_LABELS,
  SERVICE_LABELS,
  TIMELINE_LABELS,
} from './brief.options';

const SEND_FAILED =
  "We couldn't send your brief just now. Please try again in a moment, or message us on WhatsApp.";

/**
 * Handles "Start a project" briefs: checks them, keeps any file in Cloudinary,
 * records the brief as a Lead in Zoho CRM (whose workflow rules send the team
 * email and the client's confirmation), then sends a WhatsApp alert to Sleeky's
 * WhatsApp number for email and phone-call briefs. WhatsApp briefs are finished by the client,
 * who sends a pre-filled message from the website's thank-you page.
 */
@Injectable()
export class BriefService {
  private readonly logger = new Logger(BriefService.name);

  constructor(
    private readonly emailService: EmailService,
    private readonly zohoService: ZohoService,
    private readonly briefFiles: BriefFilesService,
    private readonly whatsapp: WhatsAppService,
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

    const attachment = file
      ? {
          name: file.originalname,
          buffer: file.buffer,
          mimetype: file.mimetype,
        }
      : undefined;

    // 1. The file goes to Cloudinary (private) for an expiring link the client's
    //    WhatsApp message and the team alert can carry. It's also attached to
    //    the Zoho lead, so a Cloudinary problem never loses it.
    let storedFile: StoredBriefFile | undefined;
    if (attachment && this.briefFiles.enabled) {
      try {
        storedFile = await this.briefFiles.store(attachment);
      } catch (error) {
        this.logger.error(
          'Uploading the brief attachment to Cloudinary failed',
          error,
        );
      }
    }

    // 2. The lead is saved to Zoho CRM before anything else happens.
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
        file: attachment,
        fileLink: storedFile,
      });
      this.logger.log(`Brief recorded as Zoho CRM lead ${leadId}`);
    } catch (error) {
      // Zoho is the only place a brief is kept, so the visitor is told to try
      // again, and the brief is logged so it can be added by hand if needed.
      this.logger.error('Saving the brief to Zoho CRM failed', error);
      this.logLostBrief(brief, file);
      throw new InternalServerErrorException([SEND_FAILED]);
    }

    // 3. Email and phone-call briefs: a WhatsApp alert to Sleeky's WhatsApp
    //    number. WhatsApp briefs arrive there when the client sends their
    //    pre-filled message.
    if (brief.channel !== 'whatsapp')
      await this.sendWhatsAppAlert(brief, storedFile);

    return { fileUrl: storedFile?.url };
  }

  private async sendWhatsAppAlert(
    brief: CreateBriefDto,
    storedFile?: StoredBriefFile,
  ) {
    if (!this.whatsapp.enabled) {
      this.logger.warn(
        'WhatsApp alerts are not set up (CALLMEBOT_API_KEY); skipping',
      );
      return;
    }
    try {
      await this.whatsapp.alert({
        name: brief.company ? `${brief.name} (${brief.company})` : brief.name,
        channel: CHANNEL_LABELS[brief.channel],
        contact: [brief.phone, brief.email].filter(Boolean).join(' / '),
        services: brief.services.map((id) => SERVICE_LABELS[id]).join(', '),
        timeline: TIMELINE_LABELS[brief.timeline],
        goal: brief.goal,
        fileUrl: storedFile?.url,
      });
      this.logger.log('WhatsApp alert sent');
    } catch (error) {
      // The lead is already in Zoho and its email workflow runs; the alert is extra.
      this.logger.error('WhatsApp alert failed', error);
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
