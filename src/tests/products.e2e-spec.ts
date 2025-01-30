import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../app.module';
import request from 'supertest';
import { User } from '../entities/user.entity';
import { CreateProductDto } from '../dto/create-product.dto';

interface AuthLoginResponse {
  access_token: string;
  user: User;
}

interface CreateProductResponse {
  product_id: number;
  name: string;
  description: string;
  price: number;
  category: string;
  stock_quantity: number;
  image: string;
  created_at: string;
  updated_at: string;
}

describe('Scenariusz: Tworzenie produktu (e2e)', () => {
  let app: INestApplication;
  let accessToken: string;

  const newProduct: CreateProductDto = {
    name: 'Testowy produkt',
    description: 'Opis produktu',
    price: 10,
    category: 'Owoce',
    stock_quantity: 10,
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'admin@admin.pl', password: 'hasloadmina!1' });
    const body = login.body as AuthLoginResponse;
    accessToken = body.access_token;
  });

  afterAll(async () => {
    await app.close();
  });

  it('Nie powinno pozwolić na stworzenie produktu przez usera bez tokenu', async () => {
    const response = await request(app.getHttpServer())
      .post('/products')
      .field('product', JSON.stringify(newProduct));

    expect(response.status).toBe(401);
  });

  it('Powinno pozwolić adminowi na stworzenie produktu', async () => {
    const response = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${accessToken}`)
      .field('product', JSON.stringify(newProduct))
      .expect('Content-Type', /json/)
      .expect(201);

    const body = response.body as CreateProductResponse;

    expect(body).toHaveProperty('product_id');
    expect(body.name).toBe(newProduct.name);
  });
});
