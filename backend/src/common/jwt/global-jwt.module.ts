import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';

/**
 * Makes JwtService available everywhere (JwtAuthGuard needs it, any future
 * module that wants to inspect an access token needs it) without every
 * consumer having to import @nestjs/jwt's JwtModule and re-supply the secret.
 */
@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('auth.jwtAccessSecret'),
        signOptions: {
          expiresIn: config.getOrThrow<string>('auth.jwtAccessExpiresIn') as `${number}${'s' | 'm' | 'h' | 'd'}`,
        },
      }),
    }),
  ],
  exports: [JwtModule],
})
export class GlobalJwtModule {}
