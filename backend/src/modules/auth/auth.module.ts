import { Module } from '@nestjs/common';
import { AuthController } from './controllers/auth.controller.js';
import { TeamController } from './controllers/team.controller.js';
import { AuthService } from './services/auth.service.js';
import { PasswordService } from './services/password.service.js';
import { TeamService } from './services/team.service.js';
import { TokenService } from './services/token.service.js';

@Module({
  controllers: [AuthController, TeamController],
  providers: [AuthService, PasswordService, TokenService, TeamService],
  exports: [AuthService, PasswordService, TokenService, TeamService],
})
export class AuthModule {}
