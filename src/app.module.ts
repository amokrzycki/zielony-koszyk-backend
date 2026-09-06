import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import * as process from 'node:process';
import { OrderItemModule } from './modules/order-item.module';
import { OrderModule } from './modules/order.module';
import { ProductModule } from './modules/product.module';
import { UserModule } from './modules/user.module';
import { MailModule } from './modules/mail.module';
import { AuthModule } from './auth/auth.module';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ThrottlerModule } from '@nestjs/throttler';
import { validateEnvironment } from './config/env.validation';

@Module({
  imports: [
    ConfigModule.forRoot({ cache: true, validate: validateEnvironment }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 10 }]),
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.DATABASE_URL,
      entities: [__dirname + '/**/*.entity{.ts,.js}'],
      synchronize: false,
      autoLoadEntities: true,
      schema: 'zielonykoszyk',
    }),
    ServeStaticModule.forRoot({
      rootPath: '/app/uploads',
      serveRoot: '/uploads',
    }),
    UserModule,
    ProductModule,
    OrderModule,
    OrderItemModule,
    MailModule,
    AuthModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
