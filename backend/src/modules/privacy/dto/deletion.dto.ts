import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsIn, IsUUID } from 'class-validator';
import { ERASURE_TYPES } from '../erasure';

export class CreateDeletionDto {
  @IsUUID() idempotencyKey: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(4) @ArrayUnique() @IsIn([...ERASURE_TYPES, 'ALL'], { each: true })
  types: string[];
}
