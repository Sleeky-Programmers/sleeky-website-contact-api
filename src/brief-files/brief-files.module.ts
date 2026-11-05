import { Module } from '@nestjs/common';
import { BriefFilesService } from './brief-files.service';

@Module({
  providers: [BriefFilesService],
  exports: [BriefFilesService],
})
export class BriefFilesModule {}
