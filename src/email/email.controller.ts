import { Controller, Post, Body, HttpCode } from '@nestjs/common';
import { EmailService } from './email.service';
import { CreateContactDto } from './dto/create-contact.dto';

@Controller('email')
export class EmailController {
  constructor(private readonly emailService: EmailService) {}

  @Post()
  @HttpCode(200)
  async sendContactEmail(@Body() createContactDto: CreateContactDto) {
    const { firstName, lastName, email, message } = createContactDto;
    await this.emailService.sendContactEmail(
      firstName,
      lastName,
      email,
      message,
    );
    return { message: 'Email sent successfully' };
  }
}
