import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';

/** Format d'erreur homogène (spec §10.4) : aucune stack ni détail d'infrastructure exposé. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();
    const requestId = (req as any).requestId;

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = 'Une erreur interne est survenue.';
    let details: unknown[] = [];

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const body = exception.getResponse();
      code = HttpStatus[statusCode] ?? 'ERROR';
      if (typeof body === 'string') {
        message = body;
      } else {
        const b = body as Record<string, any>;
        if (b.code) code = b.code;
        if (Array.isArray(b.message)) {
          message = 'Les données fournies sont invalides.';
          details = b.message;
          code = b.code ?? 'VALIDATION_ERROR';
        } else if (b.message) {
          message = b.message;
        }
        if (b.details) details = b.details;
      }
    } else {
      this.logger.error(`[${requestId}] ${(exception as Error)?.stack ?? exception}`);
    }

    res.status(statusCode).json({ statusCode, code, message, requestId, details });
  }
}
