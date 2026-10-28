import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NodeHttpAdapter } from './http-adapter';
import { AppModule } from './app.module';

async function main(): Promise<void> {
  const check = process.argv.includes('--check');
  const app = await NestFactory.create(AppModule, new NodeHttpAdapter(), {
    logger: false,
    abortOnError: false,
  });
  await app.listen(check ? 0 : Number(process.env.PORT ?? '3000'), '127.0.0.1');
  if (check) {
    try {
      const response = await fetch(`${await app.getUrl()}/hello/native`);
      console.log(response.status);
      console.log(await response.text());
      const missing = await fetch(`${await app.getUrl()}/missing`);
      console.log(missing.status);
    } finally {
      await app.close();
    }
    console.log('http closed');
  } else {
    app.enableShutdownHooks();
    console.error(`Listening on ${await app.getUrl()}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
