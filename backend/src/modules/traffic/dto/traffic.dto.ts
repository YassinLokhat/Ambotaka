import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsISO8601, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min,
  ValidateNested,
} from 'class-validator';

export class ObservationDto {
  @IsUUID() clientObsId: string;
  @IsISO8601() observedAt: string;
  @IsNumber() @Min(-90) @Max(90) lat: number;
  @IsNumber() @Min(-180) @Max(180) lon: number;
  @IsNumber() @Min(0) accuracyMeters: number;
  @IsNumber() @Min(0) speedMps: number;
  @IsOptional() @IsNumber() @Min(0) @Max(360) headingDeg?: number;
}

export class ObservationBatchDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => ObservationDto)
  observations: ObservationDto[];
  @IsOptional() @IsString() @MaxLength(30) appVersion?: string;
}

export class TrafficQueryDto {
  @Type(() => Number) @IsNumber() @Min(-90) @Max(90) lat: number;
  @Type(() => Number) @IsNumber() @Min(-180) @Max(180) lon: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(100) @Max(10000) radiusMeters?: number;
}
