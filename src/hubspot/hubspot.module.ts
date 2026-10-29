import { Module } from '@nestjs/common';
import { HubspotService } from './hubspot.service';

@Module({
  providers: [HubspotService],
  exports: [HubspotService],
})
export class HubspotModule {}
