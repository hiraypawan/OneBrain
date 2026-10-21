export interface VaultEnvelope {version:1;salt:string;iv:string;ciphertext:string;iterations:600000}
export interface VaultEntry {id:string;title:string;value:string;updatedAt:number}
const encode=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes));
const decode=(value:string)=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
const associated=new TextEncoder().encode('OneBrain local vault v1');
export async function deriveVaultKey(password:string,salt:Uint8Array){
 if(password.length<12||password.length>1024)throw new Error('Use a master password of at least 12 characters.');
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveKey']);
 return crypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt:salt as BufferSource,iterations:600000},key,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
export function validateEnvelope(value:any):VaultEnvelope{
 if(!value||value.version!==1||value.iterations!==600000||typeof value.salt!=='string'||typeof value.iv!=='string'||typeof value.ciphertext!=='string'||value.ciphertext.length>500000)throw new Error('Unsupported or oversized encrypted vault backup.');
 try{if(decode(value.salt).length!==16||decode(value.iv).length!==12||decode(value.ciphertext).length<16)throw new Error();}catch{throw new Error('Invalid encrypted vault format.');}
 return {version:1,iterations:600000,salt:value.salt,iv:value.iv,ciphertext:value.ciphertext};
}
export async function encryptVault(entries:VaultEntry[],key:CryptoKey,salt:string):Promise<VaultEnvelope>{
 if(entries.length>100||entries.some(e=>!e.id||!e.title.trim()||e.title.length>120||e.value.length>3000))throw new Error('Use at most 100 entries, with a short title and up to 3,000 characters each.');
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const plain=new TextEncoder().encode(JSON.stringify(entries));if(plain.length>300000)throw new Error('Vault exceeds the 300 KB encrypted-backup allowance.');
 const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:associated},key,plain);
 // Encode chunks to avoid argument-list overflow for larger encrypted backups.
 let binary='';for(const byte of new Uint8Array(ciphertext))binary+=String.fromCharCode(byte);
 return {version:1,iterations:600000,salt,iv:encode(iv),ciphertext:btoa(binary)};
}
export async function createVault(password:string){const salt=crypto.getRandomValues(new Uint8Array(16)),key=await deriveVaultKey(password,salt);return {key,envelope:await encryptVault([],key,encode(salt))};}
export async function unlockVault(value:unknown,password:string){
 const envelope=validateEnvelope(value),key=await deriveVaultKey(password,decode(envelope.salt));let entries:VaultEntry[];
 try{const clear=await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(envelope.iv) as BufferSource,additionalData:associated},key,decode(envelope.ciphertext) as BufferSource);entries=JSON.parse(new TextDecoder().decode(clear));}catch{throw new Error('Incorrect password or damaged encrypted data. Nothing was changed.');}
 if(!Array.isArray(entries)||entries.length>100||entries.some(e=>typeof e.id!=='string'||typeof e.title!=='string'||typeof e.value!=='string'))throw new Error('Invalid vault contents.');
 return {key,envelope,entries};
}
