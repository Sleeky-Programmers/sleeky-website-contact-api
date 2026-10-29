import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module';
import { HubspotModule } from '../hubspot/hubspot.module';
import { BriefController } from './brief.controller';
import { BriefService } from './brief.service';

@Module({
  imports: [EmailModule, HubspotModule],
  controllers: [BriefController],
  providers: [BriefService],
})
export class BriefModule {}
