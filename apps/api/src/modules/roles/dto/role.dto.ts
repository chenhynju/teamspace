import {
  IsString,
  MinLength,
  MaxLength,
  IsOptional,
  IsArray,
  IsIn,
  IsInt,
  Min,
  Max,
} from 'class-validator';

const DATA_SCOPES = ['ALL', 'CUSTOM', 'DEPT', 'DEPT_AND_CHILD', 'SELF'];

export class CreateRoleDto {
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  name: string;

  @IsString()
  @MinLength(2)
  @MaxLength(32)
  key: string;

  @IsOptional()
  @IsIn(DATA_SCOPES)
  dataScope?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(999)
  sort?: number;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  remark?: string;
}

export class UpdateRoleDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  name?: string;

  @IsOptional()
  @IsIn(DATA_SCOPES)
  dataScope?: string;

  @IsOptional()
  @IsIn(['NORMAL', 'DISABLED'])
  status?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sort?: number;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  remark?: string;
}

export class AssignMenusDto {
  @IsArray()
  @IsString({ each: true })
  menuIds: string[];
}

export class AssignDeptsDto {
  @IsArray()
  @IsString({ each: true })
  deptIds: string[];
}
