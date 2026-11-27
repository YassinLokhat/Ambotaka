import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class UpdateTechIncidentDto {
  @IsIn(['EN_COURS', 'RESOLU', 'CLOTURE']) status: 'EN_COURS' | 'RESOLU' | 'CLOTURE';
}
export class MetricsQueryDto {
  @IsString() @MaxLength(60) name: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(5) @Max(1440) minutes?: number;
}
export class TechIncidentQueryDto {
  @IsOptional() @IsIn(['OUVERT', 'EN_COURS', 'RESOLU', 'CLOTURE']) status?: string;
}
export class AlertQueryDto {
  /** « false » doit rester false (Boolean('false') vaudrait true). */
  @IsOptional()
  @Transform(({ value }) => (value === 'true' || value === true ? true : value === 'false' || value === false ? false : value))
  @IsBoolean()
  acknowledged?: boolean;
}
