import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { ValidationPipe, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { apiReference } from '@scalar/nestjs-api-reference'
import type { Request, Response } from 'express'
import { AppModule } from './app.module.js'
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js'
import { ResponseInterceptor } from './common/interceptors/response.interceptor.js'
import { BusinessException } from './common/exceptions/business.exception.js'
import { ErrorCode } from './common/exceptions/error-code.js'

/**
 * 挂载 API 文档（Scalar UI）。
 *
 * - 生成的 OpenAPI path 已含全局前缀（如 /api/agents），故不再 addServer('/api')，
 *   否则「Try it」会变成 /api/api/agents。空 servers 时 Scalar 以文档所在 origin 为基址。
 * - Scalar 与 openapi.json 经 express 中间件挂载（app.use），不走 Nest 路由，
 *   因此不会被 ResponseInterceptor 信封包裹，也不受全局前缀影响（路径写全）。
 */
function setupApiDocs(app: Parameters<typeof SwaggerModule.createDocument>[0]): void {
    const swaggerConfig = new DocumentBuilder()
        .setTitle('AgentHub API')
        .setDescription(
            'AgentHub 后端接口文档。除 SSE 流外，所有成功响应统一包裹为 ' +
                '`{ code, message, data, timestamp }` 信封（见各接口 200/201 响应的 schema）。'
        )
        .setVersion('0.0.0')
        .addBearerAuth()
        .build()

    const document = SwaggerModule.createDocument(app, swaggerConfig)

    // 原始 OpenAPI JSON：方便导入 Postman / Apifox 等
    app.use('/api/openapi.json', (_req: Request, res: Response) => {
        res.json(document)
    })
    // Scalar UI
    app.use('/api/reference', apiReference({ content: document }))
}

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
                new BusinessException(ErrorCode.VALIDATION_FAILED, 'Validation failed', errors)
        })
    )
    app.useGlobalInterceptors(new ResponseInterceptor())
    app.useGlobalFilters(new AllExceptionsFilter())

    // API 文档：默认开启，设 API_DOCS_ENABLED=false 可关闭（如生产环境）
    const docsEnabled = config.get<string>('API_DOCS_ENABLED', 'true') !== 'false'
    if (docsEnabled) {
        setupApiDocs(app)
    }

    const port = config.get<number>('SERVER_PORT', 3000)
    await app.listen(port)
    Logger.log(`AgentHub server listening on http://localhost:${port}/api`, 'Bootstrap')
    if (docsEnabled) {
        Logger.log(`API docs (Scalar) on http://localhost:${port}/api/reference`, 'Bootstrap')
    }
}

bootstrap()
