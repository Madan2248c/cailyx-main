import { Controller, Get, HttpCode, ServiceUnavailableException } from '@nestjs/common';
import { AppService, type HealthStatus } from './app.service.js';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  /** 200 when the API and database are up, 503 otherwise (so a load balancer stops routing here). */
  @Get('health')
  @HttpCode(200)
  async health(): Promise<HealthStatus> {
    const status = await this.appService.health();
    if (status.status !== 'ok') throw new ServiceUnavailableException(status);
    return status;
  }
}
