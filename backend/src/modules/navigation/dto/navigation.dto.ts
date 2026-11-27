import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

export class CoordinateDto {
  @IsNumber() @Min(-90) @Max(90) lat: number;
  @IsNumber() @Min(-180) @Max(180) lon: number;
}

export class RouteSearchDto {
  @ValidateNested() @Type(() => CoordinateDto) origin: CoordinateDto;
  @ValidateNested() @Type(() => CoordinateDto) destination: CoordinateDto;
  /** Précision horizontale GPS de l'origine (m), pour NAV-003. */
  @IsOptional() @IsNumber() @Min(0) originAccuracyMeters?: number;
}

export class PlaceSearchDto {
  @IsString() @MinLength(2) @MaxLength(120) q: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(-90) @Max(90) lat?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(-180) @Max(180) lon?: number;
}
