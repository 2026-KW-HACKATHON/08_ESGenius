import { defineConfig } from 'vite';
export default defineConfig({server:{proxy:{'/film':{target:'http://127.0.0.1:4102',rewrite:path=>path.replace(/^\/film/,'')},'/api':'http://127.0.0.1:4101','/health':'http://127.0.0.1:4101'}},preview:{proxy:{'/film':{target:'http://127.0.0.1:4102',rewrite:path=>path.replace(/^\/film/,'')},'/api':'http://127.0.0.1:4101','/health':'http://127.0.0.1:4101'}}});
