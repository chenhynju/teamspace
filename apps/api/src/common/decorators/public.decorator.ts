import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** 标记路由无需鉴权 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
