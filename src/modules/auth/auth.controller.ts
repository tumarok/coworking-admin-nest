import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { CurrentUserId } from '../../common/auth/current-user-id.decorator.js';
import { Public } from '../../common/auth/public.decorator.js';
import { type LoginRequest, loginRequestSchema } from '../../contract/index.js';
import { AuthService } from './auth.service.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body({ schema: loginRequestSchema }) body: LoginRequest) {
    return this.auth.login(body);
  }

  @Get('me')
  me(@CurrentUserId() userId: string) {
    return this.auth.currentUser(userId);
  }
}
