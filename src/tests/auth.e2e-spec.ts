import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../app.module';
import request from 'supertest';
import { RegisterUserDto } from '../dto/register-user.dto';
import { LoginDto } from '../dto/login.dto';

describe('Scenariusz: Rejestracja i logowanie użytkownika (e2e)', () => {
  let app: INestApplication;

  const userDto: RegisterUserDto = {
    first_name: 'Jan',
    last_name: 'Kubeczek',
    email: 'test@test.pl',
    phone: '+48123123123',
    password: 'haslotestowe123!',
    street: 'Łysakówek',
    building_number: '420',
    flat_number: '69',
    city: 'Mielec',
    zip: '39-305',
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('Powinno zarejestrować nowego użytkownika', async () => {
    const response = await request(app.getHttpServer())
      .post('/users/register')
      .send(userDto);

    expect(response.status).toBe(201);
    expect(response.body).toHaveProperty('user_id');
  });

  it('Nie powinno zarejestrować nowego użytkownika z adresem email istniejącym w bazie', async () => {
    const userDtoWithExistingEmail: RegisterUserDto = {
      first_name: 'Jan',
      last_name: 'Kubeczek',
      email: 'admin@admin.pl',
      phone: '+48123123123',
      password: 'haslotestowe123!',
      street: 'Łysakówek',
      building_number: '420',
      flat_number: '69',
      city: 'Mielec',
      zip: '39-305',
    };

    const response = await request(app.getHttpServer())
      .post('/users/register')
      .send(userDtoWithExistingEmail);

    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty('message');
  });

  it('Powinno zalogować użytkownika i zwrócić token', async () => {
    const credentials: LoginDto = {
      email: userDto.email,
      password: userDto.password,
    };

    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send(credentials);

    expect(response.status).toBe(201);
    expect(response.body).toHaveProperty('access_token');
    expect(response.body).toHaveProperty('user');
  });
});
