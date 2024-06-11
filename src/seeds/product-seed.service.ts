import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from '../entities/product.entity';
import vegatables from '../constans/vegatables';
import fruits from '../constans/fruits';
import others from '../constans/others';
import seasonal from '../constans/seasonal';
import collective from '../constans/collective';

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
