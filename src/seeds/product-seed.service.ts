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
export class ProductSeedService {
  constructor(
    @InjectRepository(Product)
    private productRepository: Repository<Product>,
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
      const newProduct = this.productRepository.create(product);
      await this.productRepository.save(newProduct);
    }
  }
}
