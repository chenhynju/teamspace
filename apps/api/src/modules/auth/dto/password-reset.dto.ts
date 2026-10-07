import { IsEmail, IsString, MinLength, MaxLength } from 'class-validator';

/** 忘记密码：提交注册邮箱 */
export class ForgotPasswordDto {
  @IsEmail()
  email!: string;
}

/** 重置密码：凭邮件 token 设置新密码 */
export class ResetPasswordDto {
  @IsString()
  token!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password!: string;
}
