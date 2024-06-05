import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from '../entities/product.entity';

@Injectable()
export class ProductSeedService {
  constructor(
    @InjectRepository(Product)
    private productRepository: Repository<Product>,
  ) {}

  async seed() {
    const products = [
      {
        name: 'Jabłko',
        description: 'Świeże czerwone jabłko',
        price: 1.2,
        category: 'Owoc',
        stock_quantity: 100,
      },
      {
        name: 'Banan',
        description: 'Dojrzały banan',
        price: 0.8,
        category: 'Owoc',
        stock_quantity: 150,
      },
      {
        name: 'Marchewka',
        description: 'Chrupiąca marchewka',
        price: 0.5,
        category: 'Warzywo',
        stock_quantity: 200,
      },
      {
        name: 'Ziemniak',
        description: 'Świeży ziemniak',
        price: 0.3,
        category: 'Warzywo',
        stock_quantity: 250,
      },
      {
        name: 'Truskawka',
        description: 'Soczysta truskawka',
        price: 2.5,
        category: 'Owoc',
        stock_quantity: 50,
      },
    ];

    for (const product of products) {
      const newProduct = this.productRepository.create(product);
      await this.productRepository.save(newProduct);
    }
  }
}
