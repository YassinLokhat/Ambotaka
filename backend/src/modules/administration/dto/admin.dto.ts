import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsNumber, IsOptional, IsString, Matches, Max, MaxLength,
  Min, MinLength, ValidateNested,
} from 'class-validator';

export class CreateUserDto {
  @Matches(/^[a-z0-9._-]{3,32}$/, { message: 'username: 3 à 32 caractères (a-z, 0-9, . _ -)' }) username: string;
  @IsString() @MinLength(12) @MaxLength(200) password: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @ArrayUnique() @IsString({ each: true }) roles: string[];
}
export class UpdateUserDto {
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @ArrayUnique() @IsString({ each: true }) roles?: string[];
  @IsOptional() @IsString() @MinLength(12) @MaxLength(200) password?: string;
}
export class CreateRoleDto {
  @Matches(/^[A-Z0-9_]{3,40}$/, { message: 'name: MAJUSCULES, chiffres, _ (3 à 40)' }) name: string;
  @IsOptional() @IsString() @MaxLength(200) description?: string;
  @IsArray() @ArrayUnique() @IsString({ each: true }) permissions: string[];
}
export class UpdateRoleDto {
  @IsOptional() @IsString() @MaxLength(200) description?: string;
  @IsOptional() @IsArray() @ArrayUnique() @IsString({ each: true }) permissions?: string[];
}
export class UpdatePermissionDto {
  @IsString() @MinLength(3) @MaxLength(200) description: string;
}
class ConfigChange {
  @IsString() @MaxLength(100) key: string;
  @IsNumber() @Min(0) @Max(1_000_000) value: number;
}
export class UpdateConfigDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => ConfigChange) changes: ConfigChange[];
}
export class ModerateIncidentDto {
  @IsIn(['RESOLVE', 'EXPIRE']) action: 'RESOLVE' | 'EXPIRE';
}
export class AuditQueryDto {
  @IsOptional() @Type(() => Number) @IsNumber() @Min(1) @Max(200) limit?: number;
  @IsOptional() @IsString() @MaxLength(200) cursor?: string;
  @IsOptional() @IsString() @MaxLength(60) action?: string;
  @IsOptional() @IsString() @MaxLength(64) admin?: string;
}
