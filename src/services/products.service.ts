import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Products } from '../entities/products.entity';
import { Like } from 'typeorm';
import { CreateProductDto } from '../dto/create-product.dto';
import { PageableProducts } from '../types/PageableProducts';

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

  async findLikeNameInCategory(
    category: string,
    name: string,
  ): Promise<Products[]> {
    return this.productsRepository.find({
      where: {
        name: Like(`%${name}%`),
        category,
      },
    });
  }

  async create(product: CreateProductDto): Promise<Products> {
    const newProduct = this.productsRepository.create(product);
    return this.productsRepository.save(newProduct);
  }

  async update(id: number, product: Partial<Products>): Promise<Products> {
    await this.productsRepository.update(id, product);
    return this.productsRepository.findOneBy({ product_id: id });
  }

  async remove(id: number): Promise<void> {
    await this.productsRepository.delete(id);
  }
}
