import { IsEmail, IsString, IsOptional } from 'class-validator';

export class CreateInvitationDto {
  @IsEmail()
  email: string;

  @IsString()
  roleId: string;

  @IsOptional()
  @IsString()
  message?: string;
}

export class AcceptInvitationDto {
  @IsString()
  token: string;
}
