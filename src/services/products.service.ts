import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Products } from '../entities/products.entity';
import { CreateProductDto } from '../dto/create-product.dto';
import { PageableProducts } from '../types/PageableProducts';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuid } from 'uuid';

interface SearchParams {
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
export class ProductsService {
  constructor(
    @InjectRepository(Products)
    private productsRepository: Repository<Products>,
  ) {}

  findAll(): Promise<Products[]> {
    return this.productsRepository.find();
  }

  findOne(id: number): Promise<Products> {
    return this.productsRepository.findOneBy({ product_id: id });
  }

  async search(params: SearchParams): Promise<PageableProducts> {
    const {
      search,
      category,
      priceMin,
      priceMax,
      page,
      pageSize,
      orderBy = 'name',
      orderDir = 'ASC',
    } = params;

    const validColumns = ['product_id', 'name', 'price'];
    const safeOrderBy = validColumns.includes(orderBy) ? orderBy : 'name';

    const query = this.productsRepository
      .createQueryBuilder('p')
      .where('1 = 1'); // dummy so we can chain .andWhere

    if (search) {
      query.andWhere('p.name LIKE :search', { search: `%${search}%` });
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

    query.orderBy(`p.${safeOrderBy}`, orderDir);

    const skip = (page - 1) * pageSize;
    query.skip(skip).take(pageSize);

    const [data, totalCount] = await query.getManyAndCount();

    const totalPages = Math.ceil(totalCount / pageSize);

    return {
      data,
      totalCount,
      currentPage: page,
      pageSize,
      totalPages,
    };
  }

  async uploadProductImage(
    productId: number,
    file: Express.Multer.File,
  ): Promise<Products> {
    if (!file) {
      throw new BadRequestException('No file provided');
    }

    const product = await this.productsRepository.findOne({
      where: { product_id: productId },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    const uploadDir = path.join(__dirname, '../../uploads');

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

    return product;
  }

  async create(
    product: CreateProductDto,
    file?: Express.Multer.File,
  ): Promise<Products> {
    const newProduct = this.productsRepository.create(product);
    const savedProduct = await this.productsRepository.save(newProduct);

    if (file) {
      const uploadDir = path.join(__dirname, '../../uploads');

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

    return savedProduct;
  }

  async update(id: number, product: Partial<Products>): Promise<Products> {
    await this.productsRepository.update(id, product);
    return this.productsRepository.findOneBy({ product_id: id });
  }

  async remove(id: number): Promise<void> {
    await this.productsRepository.delete(id);
  }
}
