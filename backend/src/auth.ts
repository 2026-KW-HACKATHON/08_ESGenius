import { createRemoteJWKSet, jwtVerify } from 'jose';
import { timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { Config } from './config.js';
import { ApiError } from './errors.js';
export function createAuth(config:Config,residentIdentity?:(token:string)=>{subject:string;admin:boolean}|undefined) {
  const jwks=config.jwksUrl?createRemoteJWKSet(new URL(config.jwksUrl)):undefined;
  const eq=(a:string,b?:string)=>!!b&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
  return async(req:FastifyRequest,admin=false)=>{
    const header=req.headers.authorization;
    if(!header?.startsWith('Bearer '))throw new ApiError(401,'AUTH_REQUIRED','로그인이 필요합니다.');
    const token=header.slice(7);let identity:{subject:string;admin:boolean}|undefined;
    if(token.startsWith('resident_')&&residentIdentity)identity=residentIdentity(token);
    else if(!config.production&&eq(token,config.devAdminToken))identity={subject:'dev-admin',admin:true};
    else if(!config.production&&eq(token,config.devUserToken))identity={subject:'dev-user',admin:false};
    else if(jwks){
      try{const {payload}=await jwtVerify(token,jwks,{issuer:config.jwtIssuer,audience:config.jwtAudience,algorithms:['RS256','ES256'],requiredClaims:['sub','exp','iat']});
        if(payload.sub)identity={subject:payload.sub,admin:config.adminSubjects.includes(payload.sub)};
      }catch{throw new ApiError(401,'INVALID_TOKEN','로그인 세션을 확인하세요.');}
    }
    if(!identity)throw new ApiError(401,'INVALID_TOKEN','유효한 로그인 토큰이 필요합니다.');
    if(admin&&!identity.admin)throw new ApiError(403,'FORBIDDEN','운영자 권한이 필요합니다.');
    return identity;
  };
}
