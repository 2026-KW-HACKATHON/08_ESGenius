import 'dotenv/config';
export type Config = {
  databasePath:string;demoMode:boolean;production:boolean;host:string;port:number;
  devUserToken?:string;devAdminToken?:string;kakaoKey?:string;
  jwtIssuer?:string;jwtAudience:string;jwksUrl?:string;adminSubjects:string[];corsOrigins:string[];
};
export function configFromEnv():Config {
  const production=process.env.NODE_ENV==='production';
  const c:Config={databasePath:process.env.DATABASE_PATH??'./data/wolgye.sqlite',demoMode:process.env.DEMO_MODE==='true',production,host:process.env.HOST??'127.0.0.1',port:Number(process.env.PORT??4100),
    devUserToken:process.env.DEV_USER_TOKEN||undefined,devAdminToken:process.env.DEV_ADMIN_TOKEN||undefined,kakaoKey:process.env.KAKAO_REST_API_KEY||undefined,
    jwtIssuer:process.env.JWT_ISSUER||undefined,jwtAudience:process.env.JWT_AUDIENCE??'authenticated',jwksUrl:process.env.JWT_JWKS_URL||undefined,
    adminSubjects:(process.env.ADMIN_SUBJECTS??'').split(',').filter(Boolean),corsOrigins:(process.env.CORS_ORIGINS??'').split(',').filter(Boolean)};
  validateConfig(c);return c;
}
export function validateConfig(c:Config) {
  if(c.production&&(c.demoMode||c.devAdminToken||c.devUserToken))throw new Error('Production forbids DEMO_MODE and development tokens.');
  if(c.production&&(!c.jwtIssuer||!c.jwksUrl))throw new Error('Production requires JWT_ISSUER and JWT_JWKS_URL.');
  if(c.jwksUrl&&!c.jwksUrl.startsWith('https://'))throw new Error('JWKS requires HTTPS.');
  if((c.jwtIssuer&&!c.jwksUrl)||(!c.jwtIssuer&&c.jwksUrl))throw new Error('Configure both JWT issuer and JWKS URL.');
  if(c.devUserToken&&c.devUserToken.length<32||c.devAdminToken&&c.devAdminToken.length<32)throw new Error('Development tokens must contain at least 32 characters.');
  if(c.devUserToken&&c.devUserToken===c.devAdminToken)throw new Error('Development roles need different tokens.');
}
