import { existsSync,readFileSync,writeFileSync,mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
if(existsSync('.env'))console.log('.env already exists; preserved.');
else {
  const template=readFileSync('.env.example','utf8').replace('DEV_USER_TOKEN=','DEV_USER_TOKEN='+randomBytes(32).toString('hex')).replace('DEV_ADMIN_TOKEN=','DEV_ADMIN_TOKEN='+randomBytes(32).toString('hex'));
  writeFileSync('.env',template,{mode:0o600});console.log('Created .env with random development tokens. Tokens are not printed.');
}
mkdirSync('data',{recursive:true});
