import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from '../entities/product.entity';
import { Like } from 'typeorm';
import { CreateProductDto } from '../dto/create-product.dto';

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product)
    private productsRepository: Repository<Product>,
  ) {}

  findAll(): Promise<Product[]> {
    return this.productsRepository.find();
  }

  findOne(id: number): Promise<Product> {
    return this.productsRepository.findOneBy({ product_id: id });
  }

  findByCategory(category: string): Promise<Product[]> {
    return this.productsRepository.findBy({ category });
  }

  async findLikeName(name: string): Promise<Product[]> {
    return this.productsRepository.find({
      where: {
        name: Like(`%${name}%`),
      },
    });
  }

  async findLikeNameInCategory(
    category: string,
    name: string,
  ): Promise<Product[]> {
    return this.productsRepository.find({
      where: {
        name: Like(`%${name}%`),
        category,
      },
    });
  }

  async create(product: CreateProductDto): Promise<Product> {
    const newProduct = this.productsRepository.create(product);
    return this.productsRepository.save(newProduct);
  }

  async update(id: number, product: Partial<Product>): Promise<Product> {
    await this.productsRepository.update(id, product);
    return this.productsRepository.findOneBy({ product_id: id });
  }

  async remove(id: number): Promise<void> {
    await this.productsRepository.delete(id);
  }
}
