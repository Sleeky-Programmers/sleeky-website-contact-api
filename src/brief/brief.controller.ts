import {
  Body,
  Controller,
  HttpCode,
  Ip,
  Post,
  UploadedFile,
  UseInterceptors,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { BriefService } from './brief.service';
import { CreateBriefDto } from './dto/create-brief.dto';
import { MAX_FILE_BYTES } from './brief.options';

@Controller('brief')
export class BriefController {
  constructor(private readonly briefService: BriefService) {}

  @Post()
  @HttpCode(200)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_FILE_BYTES, files: 1 } }),
  )
  async create(
    @Body(new ValidationPipe({ transform: true })) brief: CreateBriefDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Ip() ip: string,
  ) {
    await this.briefService.submit(brief, file, ip);
    return { message: 'Brief sent successfully' };
  }
}
