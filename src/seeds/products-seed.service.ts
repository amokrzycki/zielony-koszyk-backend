import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from '../entities/product.entity';
import vegatables from '../constants/vegatables';
import fruits from '../constants/fruits';
import others from '../constants/others';
import seasonal from '../constants/seasonal';
import collective from '../constants/collective';

@Injectable()
export class ProductsSeedService {
  constructor(
    @InjectRepository(Product)
    private productsRepository: Repository<Product>,
  ) {}

  async seed() {
    const products = [
      ...fruits,
      ...vegatables,
      ...others,
      ...seasonal,
      ...collective,
    ];

    for (const product of products) {
      const newProduct = this.productsRepository.create(product);
      await this.productsRepository.save(newProduct);
    }
  }
}
