import { IsBoolean, IsString, MaxLength, MinLength } from 'class-validator';

export class StatisticsConsentDto {
  @IsBoolean() granted: boolean;
  @IsString() @MinLength(1) @MaxLength(40) policyVersion: string;
}
