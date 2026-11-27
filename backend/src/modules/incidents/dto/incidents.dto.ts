import { Type } from 'class-transformer';
import { IsIn, IsISO8601, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export const INCIDENT_TYPES = ['ACCIDENT', 'EMBOUTEILLAGE', 'ROUTE_BLOQUEE', 'TRAVAUX', 'DANGER', 'AUTRE'] as const;
export type IncidentType = (typeof INCIDENT_TYPES)[number];

export class CreateReportDto {
  @IsIn(INCIDENT_TYPES as unknown as string[]) type: IncidentType;
  @IsOptional() @IsString() @MaxLength(300) description?: string;
  @IsNumber() @Min(-90) @Max(90) lat: number;
  @IsNumber() @Min(-180) @Max(180) lon: number;
  @IsOptional() @IsISO8601() observedAt?: string;
  /** Identifiant généré par l'appli : rend l'envoi rejouable (file hors ligne). */
  @IsOptional() @IsUUID() clientReportId?: string;
}

export class ConfirmationDto {
  @IsIn(['CONFIRMATION', 'CONTESTATION']) kind: 'CONFIRMATION' | 'CONTESTATION';
}

export class IncidentQueryDto {
  @Type(() => Number) @IsNumber() @Min(-90) @Max(90) lat: number;
  @Type(() => Number) @IsNumber() @Min(-180) @Max(180) lon: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(100) @Max(20000) radiusMeters?: number;
}
