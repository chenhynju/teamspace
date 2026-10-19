import { Controller, Post, Body, Get, Query, Res, Req, Param } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { ForgotPasswordDto, ResetPasswordDto } from './dto/password-reset.dto';
import { Public } from '../../common/decorators/public.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  register(@Body() dto: RegisterDto, @Req() req: Request) {
    return this.auth.register(dto, { traceId: req.traceId, ip: req.ip || '' });
  }

  @Public()
  @Post('verify-email')
  verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.auth.verifyEmail(dto.token);
  }

  @Public()
  @Post('resend-verification')
  resendVerification(@Body() dto: ResendVerificationDto) {
    return this.auth.resendVerification(dto.email);
  }

  @Public()
  @Post('login')
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.auth.login(dto, { traceId: req.traceId, ip: req.ip || '' });
  }

  @Public()
  @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.auth.requestPasswordReset(dto.email);
  }

  @Public()
  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto.token, dto.password);
  }

  @Public()
  @Get('oauth/providers')
  oauthProviders() {
    return this.auth.getEnabledOAuthProviders();
  }

  @Public()
  @Get('oauth/:provider/url')
  oauthUrl(@Param('provider') provider: 'google' | 'github') {
    return this.auth.getOAuthUrl(provider);
  }

  @Public()
  @Get('oauth/:provider/callback')
  oauthCallback(
    @Param('provider') provider: 'google' | 'github',
    @Query('code') code: string,
    @Query('state') state: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.auth
      .handleOAuthCallback(provider, code, state)
      .then((result) => {
        const webUrl = process.env.WEB_URL || 'http://localhost:3010';
        res.redirect(`${webUrl}/oauth/callback?token=${result.accessToken}`);
      });
  }
}
