import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

export interface SendResult {
  provider: 'resend' | 'console';
  id?: string;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly resend: Resend | null;
  private readonly from: string;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('RESEND_API_KEY')?.trim();
    const provider = this.config.get<string>('EMAIL_PROVIDER') ?? 'resend';
    this.resend = provider === 'resend' && apiKey ? new Resend(apiKey) : null;
    this.from =
      this.config.get<string>('EMAIL_FROM') ?? 'TeamSpace <onboarding@resend.dev>';
  }

  /** 是否走真实发信（否则 console 兜底，本地无 key 时仍可开发调试） */
  get isLive(): boolean {
    return this.resend !== null;
  }

  /** 注册验证邮件 */
  async sendVerificationEmail(to: string, url: string, name?: string): Promise<SendResult> {
    const hi = name ? `，${name}` : '';
    const html = `<!doctype html>
<html lang="zh-CN">
  <body style="margin:0;background:#f1f5f9;padding:32px;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;">
    <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;padding:40px;">
      <h1 style="margin:0 0 16px;font-size:20px;color:#0f172a;">欢迎加入 TeamSpace${hi}</h1>
      <p style="margin:0 0 24px;color:#475569;font-size:14px;line-height:1.7;">
        请点击下方按钮验证你的邮箱，完成注册。链接有效期为 24 小时。
      </p>
      <a href="${url}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:12px 28px;border-radius:10px;font-size:14px;">验证邮箱</a>
      <p style="margin:24px 0 0;color:#94a3b8;font-size:12px;word-break:break-all;">
        如果按钮无法点击，请复制此链接：<br />${url}
      </p>
    </div>
  </body>
</html>`;

    return this.send(to, '【TeamSpace】请验证你的邮箱', html, `[verify] ${to} -> ${url}`);
  }

  /** 密码重置邮件 */
  async sendPasswordResetEmail(to: string, url: string, name?: string): Promise<SendResult> {
    const hi = name ? `，${name}` : '';
    const html = `<!doctype html>
<html lang="zh-CN">
  <body style="margin:0;background:#f1f5f9;padding:32px;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;">
    <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;padding:40px;">
      <h1 style="margin:0 0 16px;font-size:20px;color:#0f172a;">重置你的 TeamSpace 密码${hi}</h1>
      <p style="margin:0 0 24px;color:#475569;font-size:14px;line-height:1.7;">
        我们收到了重置密码的请求。请点击下方按钮设置新密码，链接有效期为 1 小时。<br />
        如果这不是你本人的操作，请忽略此邮件，你的密码不会改变。
      </p>
      <a href="${url}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:12px 28px;border-radius:10px;font-size:14px;">重置密码</a>
      <p style="margin:24px 0 0;color:#94a3b8;font-size:12px;word-break:break-all;">
        如果按钮无法点击，请复制此链接：<br />${url}
      </p>
    </div>
  </body>
</html>`;

    return this.send(to, '【TeamSpace】重置你的密码', html, `[reset] ${to} -> ${url}`);
  }

  private async send(to: string, subject: string, html: string, consolePreview: string) {
    if (!this.resend) {
      this.logger.warn(`未配置 RESEND_API_KEY，邮件未真实发出：\n${consolePreview}`);
      return { provider: 'console' as const };
    }
    const { data, error } = await this.resend.emails.send({
      from: this.from,
      to,
      subject,
      html,
    });
    if (error) {
      this.logger.error(`Resend 发信失败: ${JSON.stringify(error)}`);
      throw new Error(`email provider error: ${error.message ?? 'unknown'}`);
    }
    this.logger.log(`邮件已发送 via Resend id=${data?.id} to=${to}`);
    return { provider: 'resend' as const, id: data?.id };
  }
}
