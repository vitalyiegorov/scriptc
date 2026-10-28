import { Controller, Get, Injectable, Module, Param } from '@nestjs/common';
import { of } from 'rxjs';

@Injectable()
export class GreetingService {
  greet(name: string): string {
    return `Hello, ${name}!`;
  }
}

@Controller('hello')
class GreetingController {
  constructor(private readonly greeting: GreetingService) {}

  @Get(':name')
  hello(@Param('name') name: string) {
    return of({ message: this.greeting.greet(name) });
  }
}

@Module({ controllers: [GreetingController], providers: [GreetingService] })
export class AppModule {}
