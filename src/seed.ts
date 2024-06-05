import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ProductSeedService } from './seeds/product-seed.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const productSeedService = app.get(ProductSeedService);
  await productSeedService.seed();
  await app.close();
}

bootstrap().catch((error) => console.error('Error seeding database:', error));
