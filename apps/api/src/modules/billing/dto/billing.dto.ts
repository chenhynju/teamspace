import { IsString, IsIn, IsObject, IsOptional } from 'class-validator';

export class SubscribeDto {
  @IsString()
  planCode: string;

  @IsOptional()
  @IsIn(['monthly', 'yearly'])
  interval?: string;
}

export class WebhookDto {
  @IsString()
  provider: string;

  @IsString()
  eventId: string;

  @IsString()
  type: string;

  @IsString()
  organizationId: string;

  @IsObject()
  payload: Record<string, any>;
}
