import {describe,it,expect} from 'vitest';import {encrypt,decrypt} from '../src/services.js';
describe('AES-GCM digital payload',()=>{
 it('round trips without putting plaintext in database value',()=>{const value=encrypt('private-license');expect(value).not.toContain('private-license');expect(decrypt(value)).toBe('private-license');});
 it('rejects modified authentication tag',()=>{const parts=encrypt('secret').split('.');parts[1]='00'.repeat(16);expect(()=>decrypt(parts.join('.'))).toThrow();});
});
