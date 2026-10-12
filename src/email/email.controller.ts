import { Controller, Post, Body, HttpCode, Ip } from '@nestjs/common';
import { EmailService } from './email.service';
import { CreateContactDto } from './dto/create-contact.dto';

@Controller('email')
export class EmailController {
  constructor(private readonly emailService: EmailService) {}

  @Post()
  @HttpCode(200)
  async sendContactEmail(
    @Body() createContactDto: CreateContactDto,
    @Ip() ip: string,
  ) {
    const { firstName, lastName, email, phone, message, captchaToken } =
      createContactDto;
    await this.emailService.verifyCaptcha(captchaToken, ip);
    await this.emailService.sendContactEmail(
      firstName,
      lastName,
      email,
      phone,
      message,
    );
    return { message: 'Email sent successfully' };
  }
}
