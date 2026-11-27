import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AdminAuthController } from './admin-auth.controller';
import { AdminAuthService } from './admin-auth.service';
import { AdminConfigService } from './admin-config.service';
import { AdminOpsService } from './admin-ops.service';
import { AdminUsersService } from './admin-users.service';
import { AdminController } from './admin.controller';
import { AdminGuard } from './admin.guard';
import { AuditService } from './audit.service';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (c: ConfigService) => {
        const secret = c.get<string>('jwtSecret') ?? '';
        if (c.get('nodeEnv') === 'production' && secret.length < 32) throw new Error('JWT_SECRET (≥ 32 caractères) est obligatoire en production.');
        return { secret };
      },
    }),
  ],
  controllers: [AdminAuthController, AdminController],
  providers: [AdminAuthService, AdminUsersService, AdminConfigService, AdminOpsService, AuditService, AdminGuard],
  exports: [AdminGuard, AdminAuthService, AuditService],
})
export class AdministrationModule {}
