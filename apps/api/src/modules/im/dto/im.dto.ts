import { IsArray, IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CreateDirectDto {
  @IsString()
  @IsNotEmpty()
  userId!: string;
}

export class CreateGroupDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(64)
  title!: string;

  @IsArray()
  @IsString({ each: true })
  memberIds!: string[];
}

export class AddMembersDto {
  @IsArray()
  @IsString({ each: true })
  userIds!: string[];
}

export class SendMessageDto {
  @IsIn(['TEXT', 'IMAGE', 'FILE'])
  type!: 'TEXT' | 'IMAGE' | 'FILE';

  @IsString()
  @MaxLength(4000)
  content!: string;

  @IsOptional()
  @IsString()
  attachmentId?: string;
}

export class MarkReadDto {
  @IsString()
  @IsNotEmpty()
  lastReadMessageId!: string;
}
