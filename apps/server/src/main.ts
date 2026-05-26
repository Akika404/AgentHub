import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { ValidationPipe, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { AppModule } from './app.module'
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter'
import { ResponseInterceptor } from './common/interceptors/response.interceptor'
import { BusinessException } from './common/exceptions/business.exception'
import { ErrorCode } from './common/exceptions/error-code'

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule)
  const config = app.get(ConfigService)

  app.setGlobalPrefix('api')
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      exceptionFactory: (errors) =>
        new BusinessException(ErrorCode.VALIDATION_FAILED, 'Validation failed', errors),
    }),
  )
  app.useGlobalInterceptors(new ResponseInterceptor())
  app.useGlobalFilters(new AllExceptionsFilter())

  const port = config.get<number>('SERVER_PORT', 3000)
  await app.listen(port)
  Logger.log(`AgentHub server listening on http://localhost:${port}/api`, 'Bootstrap')
}

bootstrap()
