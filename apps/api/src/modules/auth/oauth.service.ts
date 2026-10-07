import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { nanoid } from 'nanoid';

export interface OAuthProfile {
  id: string;
  email?: string;
  name?: string;
  avatarUrl?: string;
  accessToken?: string;
  refreshToken?: string;
}

@Injectable()
export class OAuthService {
  private readonly logger = new Logger(OAuthService.name);
  private redis: Redis;

  constructor(private readonly config: ConfigService) {
    const url = this.config.get<string>('REDIS_URL') ?? 'redis://localhost:6379';
    this.redis = new Redis(url);
  }

  private getGoogleCreds() {
    return {
      clientId: this.config.get('GOOGLE_CLIENT_ID', ''),
      clientSecret: this.config.get('GOOGLE_CLIENT_SECRET', ''),
      callback: this.config.get('GOOGLE_CALLBACK_URL', ''),
    };
  }

  private getGithubCreds() {
    return {
      clientId: this.config.get('GITHUB_CLIENT_ID', ''),
      clientSecret: this.config.get('GITHUB_CLIENT_SECRET', ''),
      callback: this.config.get('GITHUB_CALLBACK_URL', ''),
    };
  }

  isEnabled(provider: 'google' | 'github'): boolean {
    const c = provider === 'google' ? this.getGoogleCreds() : this.getGithubCreds();
    return !!(c.clientId && c.clientSecret && c.callback);
  }

  async getAuthorizeUrl(provider: 'google' | 'github'): Promise<string> {
    const creds = provider === 'google' ? this.getGoogleCreds() : this.getGithubCreds();
    if (!creds.clientId || !creds.clientSecret || !creds.callback) {
      throw new BadRequestException({
        code: 'OAUTH_NOT_CONFIGURED',
        message: `${provider} 登录未配置，请使用邮箱登录`,
      });
    }
    const state = nanoid(24);
    await this.redis.set(`oauth:state:${state}`, provider, 'EX', 300); // 5 分钟

    if (provider === 'google') {
      const { clientId, callback } = this.getGoogleCreds();
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: callback,
        response_type: 'code',
        scope: 'openid email profile',
        state,
      });
      return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
    } else {
      const { clientId, callback } = this.getGithubCreds();
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: callback,
        scope: 'user:email read:user',
        state,
      });
      return `https://github.com/login/oauth/authorize?${params}`;
    }
  }

  async exchangeCode(
    provider: 'google' | 'github',
    code: string,
    state: string,
  ): Promise<OAuthProfile> {
    // 校验并一次性消费 state
    const stored = await this.redis.get(`oauth:state:${state}`);
    if (!stored || stored !== provider) {
      throw new BadRequestException({ code: 'INVALID_STATE', message: '无效或已过期的 state' });
    }
    await this.redis.del(`oauth:state:${state}`);

    if (provider === 'google') {
      return this.googleExchange(code);
    }
    return this.githubExchange(code);
  }

  private async googleExchange(code: string): Promise<OAuthProfile> {
    const { clientId, clientSecret, callback } = this.getGoogleCreds();
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: callback,
        grant_type: 'authorization_code',
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      throw new BadRequestException({ code: 'OAUTH_TOKEN_FAILED', message: 'Google 令牌交换失败' });
    }

    const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const u = await userRes.json();
    return {
      id: u.sub,
      email: u.email,
      name: u.name,
      avatarUrl: u.picture,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
    };
  }

  private async githubExchange(code: string): Promise<OAuthProfile> {
    const { clientId, clientSecret, callback } = this.getGithubCreds();
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: callback,
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      throw new BadRequestException({ code: 'OAUTH_TOKEN_FAILED', message: 'GitHub 令牌交换失败' });
    }

    const userRes = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${tokenData.access_token}`, Accept: 'application/vnd.github+json' },
    });
    const u = await userRes.json();

    // GitHub 邮箱可能是 private，单独拉取
    let email = u.email;
    if (!email) {
      const emailRes = await fetch('https://api.github.com/user/emails', {
        headers: { Authorization: `Bearer ${tokenData.access_token}`, Accept: 'application/vnd.github+json' },
      });
      const emails = await emailRes.json();
      const primary = emails?.find((e: any) => e.primary);
      email = primary?.email;
    }

    return {
      id: String(u.id),
      email,
      name: u.name || u.login,
      avatarUrl: u.avatar_url,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
    };
  }
}
