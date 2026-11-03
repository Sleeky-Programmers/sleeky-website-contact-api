import { Module } from '@nestjs/common';
import { ZohoService } from './zoho.service';

@Module({
  providers: [ZohoService],
  exports: [ZohoService],
})
export class ZohoModule {}
