import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ProductsSeedService } from './seeds/products-seed.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const productSeedService = app.get(ProductsSeedService);
  await productSeedService.seed();
  await app.close();
}

bootstrap().catch((error) => console.error('Error seeding database:', error));
