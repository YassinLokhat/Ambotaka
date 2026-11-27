import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, QueryResultRow } from 'pg';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  readonly pool: Pool;

  constructor(config: ConfigService) {
    this.pool = new Pool({ connectionString: config.get<string>('databaseUrl'), max: 10 });
  }

  query<T extends QueryResultRow = any>(text: string, params?: unknown[]) {
    return this.pool.query<T>(text, params);
  }

  async ping(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  onModuleDestroy() {
    return this.pool.end();
  }
}
