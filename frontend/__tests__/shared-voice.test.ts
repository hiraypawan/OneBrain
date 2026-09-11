import {describe,it,expect} from 'vitest';
import {sharedIntent} from '../lib/shared-voice';
import {prepareVoiceInput} from '../lib/voice-input';
describe('explicit shared voice intents',()=>{
 it('does not infer uploads from ordinary conversation or local captures',()=>{expect(sharedIntent('remember Rahul')).toBeNull();expect(sharedIntent('task: Call Rahul')).toBeNull();expect(sharedIntent('Share everything')).toBeNull();});
 it('requires an explicit bounded command and preserves the reviewed content',()=>{expect(sharedIntent('shared task: Call Rahul')).toEqual({kind:'task',title:'Call Rahul',body:'Call Rahul'});expect(sharedIntent('server reminder: Send proposal')?.kind).toBe('reminder');expect(()=>sharedIntent('shared note: '+'x'.repeat(6001))).toThrow();});
});
describe('optional active-session wake phrase and recognition aliases',()=>{
 it('does not gate speech when disabled',()=>{expect(prepareVoiceInput('hello',{})).toBe('hello');});
 it('accepts addressed requests, not ambient mentions, while keeping stop and pause available',()=>{expect(prepareVoiceInput('Hey OneBrain, hello',{wakePhrase:true})).toBe('hello');expect(prepareVoiceInput('I mentioned OneBrain earlier',{wakePhrase:true})).toBeNull();expect(prepareVoiceInput('stop',{wakePhrase:true})).toBe('stop');expect(prepareVoiceInput('pause session',{wakePhrase:true})).toBe('pause session');});
 it('escapes aliases and respects Unicode name boundaries',()=>{expect(prepareVoiceInput('Ask ABC co and not ABC company',{speechAliases:{'ABC co':'ABC Corporation'}})).toBe('Ask ABC Corporation and not ABC company');expect(prepareVoiceInput('A+B joined',{speechAliases:{'A+B':'The Studio'}})).toBe('The Studio joined');expect(prepareVoiceInput('राम से पूछो',{speechAliases:{'राम':'Ram'}})).toBe('Ram से पूछो');});
});
