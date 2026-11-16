import { Module } from '@nestjs/common';
import { parseEnvironment } from './environment';

export const API_CONFIG = Symbol('API_CONFIG');

@Module({
  providers: [
    { provide: API_CONFIG, useFactory: () => parseEnvironment(process.env) },
  ],
  exports: [API_CONFIG],
})
export class ConfigModule {}
