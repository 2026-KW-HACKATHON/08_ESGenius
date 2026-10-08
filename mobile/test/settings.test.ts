import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validApiUrl, validKakaoKey } from '../src/settings';
test('connection rejects credential URLs and public cleartext; USB loopback supported',()=>{
  assert.equal(validApiUrl(''),''); // deployment uses the phone's current HTTPS origin
  assert.equal(validApiUrl('http://127.0.0.1:4101'),'http://127.0.0.1:4101');
  assert.equal(validApiUrl('https://api.example.com/'),'https://api.example.com');
  for(const url of ['http://api.example.com','https://user:secret@api.example.com','https://api.example.com/path','https://api.example.com?token=secret','file:///data'])assert.throws(()=>validApiUrl(url));
});
test('Kakao setting accepts absent key and public JS key format only',()=>{
  assert.equal(validKakaoKey(''),'');assert.equal(validKakaoKey('a'.repeat(32)),'a'.repeat(32));assert.throws(()=>validKakaoKey('<script>'));
});
