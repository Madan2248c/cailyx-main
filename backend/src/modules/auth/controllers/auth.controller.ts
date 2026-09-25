import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import type { AccessTokenPayload } from '../../../common/jwt/access-token-payload.js';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';
import { AcceptInviteDto } from '../dto/accept-invite.dto.js';
import { ForgotPasswordDto } from '../dto/forgot-password.dto.js';
import { LoginDto } from '../dto/login.dto.js';
import { RefreshTokenDto } from '../dto/refresh-token.dto.js';
import { ResetPasswordDto } from '../dto/reset-password.dto.js';
import { ValidateTokenDto } from '../dto/validate-token.dto.js';
import type { RequestMeta } from '../services/auth.service.js';
import { AuthService } from '../services/auth.service.js';

/** Self-service authentication endpoints: login, session refresh/logout, invite acceptance, and password reset. Shared by every role — see docs/analysis/auth.md. */
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /** POST /auth/login — email+password login for any role. */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.authService.login(dto, this.meta(req));
  }

  /** POST /auth/refresh — rotates a refresh token for a new session. */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshTokenDto, @Req() req: Request) {
    return this.authService.refresh(dto, this.meta(req));
  }

  /** POST /auth/logout — revokes the given refresh token. */
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(@Body() dto: RefreshTokenDto) {
    return this.authService.logout(dto);
  }

  /** POST /auth/accept-invite — consumes an invite token, sets a password, and logs the user in. */
  @Post('accept-invite')
  @HttpCode(HttpStatus.OK)
  acceptInvite(@Body() dto: AcceptInviteDto, @Req() req: Request) {
    return this.authService.acceptInvite(dto, this.meta(req));
  }

  /** POST /auth/accept-invite/validate — read-only check used to render the onboarding page correctly. */
  @Post('accept-invite/validate')
  @HttpCode(HttpStatus.OK)
  async validateInvite(@Body() dto: ValidateTokenDto) {
    return { valid: await this.authService.isInviteTokenValid(dto.token) };
  }

  /** POST /auth/forgot-password — self-service reset request; always returns a generic response. */
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  /** POST /auth/reset-password — consumes a reset token and sets a new password. */
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  resetPassword(@Body() dto: ResetPasswordDto, @Req() req: Request) {
    return this.authService.resetPassword(dto, this.meta(req));
  }

  /** POST /auth/reset-password/validate — read-only check used to render the reset page correctly. */
  @Post('reset-password/validate')
  @HttpCode(HttpStatus.OK)
  async validateReset(@Body() dto: ValidateTokenDto) {
    return { valid: await this.authService.isResetTokenValid(dto.token) };
  }

  /** GET /auth/me — returns the caller's own token claims. Requires a valid access token. */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AccessTokenPayload) {
    return user;
  }

  private meta(req: Request): RequestMeta {
    return {
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    };
  }
}
