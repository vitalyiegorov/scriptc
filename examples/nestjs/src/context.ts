import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { firstValueFrom, of } from 'rxjs';
import { AppModule, GreetingService } from './app.module';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
    abortOnError: false,
  });
  try {
    console.log(app.get(GreetingService).greet('native Nest'));
    console.log(await firstValueFrom(of('rxjs value')));
  } finally {
    await app.close();
  }
  console.log('context closed');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
