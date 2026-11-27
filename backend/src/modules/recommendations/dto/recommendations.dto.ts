import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsNumber, IsString, Max, MaxLength, Min, MinLength, ValidateNested,
} from 'class-validator';

class PointDto {
  @IsNumber() @Min(-90) @Max(90) lat: number;
  @IsNumber() @Min(-180) @Max(180) lon: number;
}

export class EvaluateDto {
  @IsString() @MinLength(1) @MaxLength(64) sessionId: string;
  @ValidateNested() @Type(() => PointDto) position: PointDto;
  @ValidateNested() @Type(() => PointDto) destination: PointDto;
  /** Partie restante de l'itinéraire courant, [lon, lat] (échantillonnée côté client). */
  @IsArray() @ArrayMinSize(2) @ArrayMaxSize(500) currentRoute: [number, number][];
}

export class DecisionDto {
  @IsIn(['ACCEPTEE', 'IGNOREE']) decision: 'ACCEPTEE' | 'IGNOREE';
}
