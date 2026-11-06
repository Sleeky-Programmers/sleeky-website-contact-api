import { Module } from '@nestjs/common';
import { BriefFilesModule } from '../brief-files/brief-files.module';
import { EmailModule } from '../email/email.module';
import { ZohoModule } from '../zoho/zoho.module';
import { BriefController } from './brief.controller';
import { BriefService } from './brief.service';

@Module({
  imports: [EmailModule, ZohoModule, BriefFilesModule],
  controllers: [BriefController],
  providers: [BriefService],
})
export class BriefModule {}
