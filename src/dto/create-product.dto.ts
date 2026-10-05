import { Type } from 'class-transformer';
import {
  IsDefined,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class ProductTextDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  description: string;
}

/** One entry per supported locale; adding a locale means adding a property here and to `LOCALES`. */
export class ProductTranslationsDto {
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => ProductTextDto)
  pl: ProductTextDto;

  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => ProductTextDto)
  en: ProductTextDto;
}

export class CreateProductDto {
  @IsNumber()
  @Min(0)
  price: number;

  @IsString()
  @IsNotEmpty()
  category: string;

  @IsInt()
  @Min(0)
  stock_quantity: number;

  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => ProductTranslationsDto)
  translations: ProductTranslationsDto;
}

class PartialProductTranslationsDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => ProductTextDto)
  pl?: ProductTextDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ProductTextDto)
  en?: ProductTextDto;
}

export class UpdateProductDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  category?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  stock_quantity?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => PartialProductTranslationsDto)
  translations?: PartialProductTranslationsDto;
}
