import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Product } from '../entities/product.entity';
import { ProductTranslation } from '../entities/product-translation.entity';
import { CreateProductDto, UpdateProductDto } from '../dto/create-product.dto';
import {
  ProductResponseDto,
  toProductResponse,
} from '../dto/product-response.dto';
import { PageableProducts } from '../types/PageableProducts';
import { DEFAULT_LOCALE, LOCALES, Locale } from '../i18n/locale';
import { coded, ErrorCode } from '../errors/error-code';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuid } from 'uuid';

export type ProductTranslations = Record<
  Locale,
  { name: string; description: string }
>;

interface SearchParams {
  locale: Locale;
  search?: string;
  category?: string;
  priceMin?: number;
  priceMax?: number;
  page?: number;
  pageSize?: number;
  orderBy?: string;
  orderDir?: 'ASC' | 'DESC';
}

@Injectable()
export class ProductService {
  constructor(
    @InjectRepository(Product)
    private productsRepository: Repository<Product>,
    private dataSource: DataSource,
  ) {}

  /**
   * Base query with the requested locale's translation (`tl`) and the default-locale one (`tf`) joined in, so a missing
   * translation falls back to Polish. One row per product: a single query, no N+1, and offset/limit stay correct.
   */
  private localizedQuery(locale: Locale) {
    return this.productsRepository
      .createQueryBuilder('p')
      .leftJoinAndMapOne(
        'p.localized',
        ProductTranslation,
        'tl',
        'tl.product_id = p.product_id AND tl.locale = :locale',
        { locale },
      )
      .leftJoinAndMapOne(
        'p.fallback',
        ProductTranslation,
        'tf',
        'tf.product_id = p.product_id AND tf.locale = :fallbackLocale',
        { fallbackLocale: DEFAULT_LOCALE },
      );
  }

  async findAll(locale: Locale): Promise<ProductResponseDto[]> {
    const products = await this.localizedQuery(locale)
      .orderBy('p.product_id', 'ASC')
      .getMany();
    return products.map(toProductResponse);
  }

  async findOne(id: number, locale: Locale): Promise<ProductResponseDto> {
    const product = await this.localizedQuery(locale)
      .where('p.product_id = :id', { id })
      .getOne();
    return product ? toProductResponse(product) : null;
  }

  async search(params: SearchParams): Promise<PageableProducts> {
    const {
      locale,
      search,
      category,
      priceMin,
      priceMax,
      page,
      pageSize,
      orderBy = 'name',
      orderDir = 'ASC',
    } = params;

    // Whitelisted ordering; `name` sorts by the active language's text, not by a stored column.
    const orderColumns: Record<string, string> = {
      product_id: 'p.product_id',
      name: 'COALESCE(tl.name, tf.name)',
      price: 'p.price',
    };
    const orderColumn = orderColumns[orderBy] ?? orderColumns.name;

    const query = this.localizedQuery(locale).where('1 = 1'); // dummy so we can chain .andWhere

    if (search) {
      query.andWhere('COALESCE(tl.name, tf.name) ILIKE :search', {
        search: `%${search}%`,
      });
    }

    if (category) {
      query.andWhere('p.category = :cat', { cat: category });
    }

    if (priceMin !== undefined) {
      query.andWhere('p.price >= :min', { min: priceMin });
    }

    if (priceMax !== undefined) {
      query.andWhere('p.price <= :max', { max: priceMax });
    }

    query.orderBy(orderColumn, orderDir).addOrderBy('p.product_id', 'ASC');

    query.offset((page - 1) * pageSize).limit(pageSize);

    const [data, totalCount] = await query.getManyAndCount();

    const totalPages = Math.ceil(totalCount / pageSize);

    return {
      data: data.map(toProductResponse),
      totalCount,
      currentPage: page,
      pageSize,
      totalPages,
    };
  }

  /** Every language at once, for the admin editor. Locales without a row come back empty. */
  async findTranslations(id: number): Promise<ProductTranslations> {
    const product = await this.productsRepository.findOne({
      where: { product_id: id },
      relations: { translations: true },
    });
    if (!product) {
      throw coded(
        NotFoundException,
        ErrorCode.PRODUCT_NOT_FOUND,
        'Product not found',
      );
    }
    return Object.fromEntries(
      LOCALES.map((locale) => {
        const row = product.translations.find((t) => t.locale === locale);
        return [
          locale,
          { name: row?.name ?? '', description: row?.description ?? '' },
        ];
      }),
    ) as ProductTranslations;
  }

  async uploadProductImage(
    productId: number,
    file: Express.Multer.File,
    locale: Locale,
  ): Promise<ProductResponseDto> {
    if (!file) {
      throw coded(
        BadRequestException,
        ErrorCode.FILE_REQUIRED,
        'No file provided',
      );
    }

    const product = await this.productsRepository.findOne({
      where: { product_id: productId },
    });

    if (!product) {
      throw coded(
        NotFoundException,
        ErrorCode.PRODUCT_NOT_FOUND,
        'Product not found',
      );
    }

    const uploadDir = '/app/uploads';

    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    if (product.image) {
      const existingImage = path.join(__dirname, '../../', product.image);
      if (fs.existsSync(existingImage)) {
        fs.rm(existingImage, (err) => {
          if (err) {
            throw new NotFoundException('Error deleting existing image');
          }
        });
      }
    }

    const extension = path.extname(file.originalname);
    const filename = uuid() + extension;
    const filepath = path.join(uploadDir, filename);

    fs.writeFileSync(filepath, file.buffer);

    product.image = `uploads/${filename}`;
    product.updated_at = new Date();
    await this.productsRepository.save(product);

    return this.findOne(productId, locale);
  }

  async create(
    product: CreateProductDto,
    locale: Locale,
    file?: Express.Multer.File,
  ): Promise<ProductResponseDto> {
    const newProduct = this.productsRepository.create({
      price: product.price,
      category: product.category,
      stock_quantity: product.stock_quantity,
      translations: LOCALES.map((translationLocale) => ({
        locale: translationLocale,
        ...product.translations[translationLocale],
      })),
    });
    const savedProduct = await this.productsRepository.save(newProduct);

    if (file) {
      const uploadDir = '/app/uploads';

      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }

      const extension = path.extname(file.originalname);
      const filename = uuid() + extension;
      const filepath = path.join(uploadDir, filename);

      fs.writeFileSync(filepath, file.buffer);

      savedProduct.image = `uploads/${filename}`;
      await this.productsRepository.save(savedProduct);
    }

    return this.findOne(savedProduct.product_id, locale);
  }

  async update(
    id: number,
    product: UpdateProductDto,
    locale: Locale,
  ): Promise<ProductResponseDto> {
    await this.dataSource.transaction(async (manager) => {
      if (!(await manager.existsBy(Product, { product_id: id }))) {
        throw coded(
          NotFoundException,
          ErrorCode.PRODUCT_NOT_FOUND,
          'Product not found',
        );
      }

      const { price, category, stock_quantity } = product;
      const shared = Object.fromEntries(
        Object.entries({ price, category, stock_quantity }).filter(
          ([, value]) => value !== undefined,
        ),
      );
      if (Object.keys(shared).length > 0) {
        await manager.update(Product, id, shared);
      }

      for (const translationLocale of LOCALES) {
        const text = product.translations?.[translationLocale];
        if (text) {
          await manager.upsert(
            ProductTranslation,
            { product_id: id, locale: translationLocale, ...text },
            ['product_id', 'locale'],
          );
        }
      }
    });

    return this.findOne(id, locale);
  }

  async remove(id: number): Promise<void> {
    await this.productsRepository.delete(id);
  }
}
