import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;

  constructor(config: ConfigService) {
    // maxRetriesPerRequest: null est requis par BullMQ si la connexion est réutilisée.
    this.client = new Redis(config.get<string>('redisUrl')!, {
      lazyConnect: true,
      maxRetriesPerRequest: null,
    });
    this.client.on('error', () => undefined); // l'état est exposé via /health
  }

  async ping(): Promise<boolean> {
    try {
      if (this.client.status === 'wait') await this.client.connect();
      const pong = await Promise.race([
        this.client.ping(),
        new Promise<string>((_, rej) => setTimeout(() => rej(new Error('timeout')), 1500)),
      ]);
      return pong === 'PONG';
    } catch {
      return false;
    }
  }

  onModuleDestroy() {
    this.client.disconnect();
  }
}
