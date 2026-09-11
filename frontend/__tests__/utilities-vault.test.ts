import {describe,it,expect} from 'vitest';
import {addDays,dateDifference,convertUnit,pauseTimer,resumeTimer,timerRemaining} from '../lib/utilities';
import {createVault,unlockVault,encryptVault,validateEnvelope} from '../lib/vault';
describe('deterministic everyday utilities',()=>{
 it('converts compatible units without floating point display noise',()=>{expect(convertUnit(2,'km','m')).toBe(2000);expect(convertUnit(1,'lb','g')).toBe(453.59237);expect(convertUnit(32,'F','C')).toBe(0);expect(convertUnit(0,'C','K')).toBe(273.15);});
 it('refuses incompatible dimensions and non-finite inputs',()=>{expect(()=>convertUnit(1,'m','kg')).toThrow();expect(()=>convertUnit(Infinity,'kg','g')).toThrow();expect(()=>convertUnit(-1,'K','C')).toThrow();});
 it('calculates calendar days independently of DST and validates real dates',()=>{expect(dateDifference('2026-03-08','2026-03-09')).toBe(1);expect(addDays('2028-02-28',1)).toBe('2028-02-29');expect(addDays('2026-01-01',-1)).toBe('2025-12-31');expect(()=>addDays('2026-02-29',1)).toThrow();expect(()=>addDays('2026-01-01',1.5)).toThrow();});
 it('keeps timer semantics correct across pause, resume and delayed browser wakeup',()=>{const t={id:'test',label:'Timer',remaining:10000,deadline:20000,done:false};expect(timerRemaining(t,15000)).toBe(5000);const paused=pauseTimer(t,15000);expect(timerRemaining(paused,900000)).toBe(5000);const resumed=resumeTimer(paused,900000);expect(resumed.deadline).toBe(905000);expect(timerRemaining(resumed,999999)).toBe(0);});
});
describe('password-encrypted local vault',()=>{
 it('encrypts titles/values with a non-extractable key and decrypts with the right password',async()=>{
  const {key,envelope}=await createVault('test-only-password-123');expect(key.extractable).toBe(false);
  const entries=[{id:'one',title:'Test secret title',value:'sensitive test value',updatedAt:1}];const encrypted=await encryptVault(entries,key,envelope.salt);
  expect(JSON.stringify(encrypted)).not.toContain('sensitive test value');expect(JSON.stringify(encrypted)).not.toContain('Test secret title');
  expect((await unlockVault(encrypted,'test-only-password-123')).entries).toEqual(entries);
  const second=await encryptVault(entries,key,envelope.salt);expect(second.iv).not.toBe(encrypted.iv);expect(second.ciphertext).not.toBe(encrypted.ciphertext);
 });
 it('fails closed on the wrong password, tampering, or unsafe KDF metadata',async()=>{
  const {envelope}=await createVault('test-only-password-123');await expect(unlockVault(envelope,'different-test-password')).rejects.toThrow('Incorrect password');
  const tampered={...envelope,ciphertext:(envelope.ciphertext[0]==='A'?'B':'A')+envelope.ciphertext.slice(1)};await expect(unlockVault(tampered,'test-only-password-123')).rejects.toThrow();
  expect(()=>validateEnvelope({...envelope,iterations:1})).toThrow();await expect(createVault('short')).rejects.toThrow();
 });
});
