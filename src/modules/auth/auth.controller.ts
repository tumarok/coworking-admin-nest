import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUserId } from '../../common/auth/current-user-id.decorator.js';
import { Public } from '../../common/auth/public.decorator.js';
import { ApiRoute } from '../../common/openapi/api-route.js';
import {
  type LoginRequest,
  loginRequestSchema,
  loginResponseSchema,
  userSchema,
} from '../../contract/index.js';
import { AuthService } from './auth.service.js';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiRoute({
    summary: 'Sign in with email and password',
    success: { status: 200, schema: loginResponseSchema },
    failures: [401, 422],
    authenticated: false,
  })
  login(@Body({ schema: loginRequestSchema }) body: LoginRequest) {
    return this.auth.login(body);
  }

  @Get('me')
  @ApiRoute({ summary: 'The signed-in user', success: { status: 200, schema: userSchema } })
  me(@CurrentUserId() userId: string) {
    return this.auth.currentUser(userId);
  }
}
