// Server-only envelope. Secrets are never returned to browsers or written in logs.
const bytes=value=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
const base64=value=>btoa(String.fromCharCode(...new Uint8Array(value)));
export class CredentialEnvelope{
 constructor({key,crypto=globalThis.crypto}){const raw=bytes(key||'');if(raw.length!==32)throw new Error('WorkLog sync encryption key must be 32 bytes');this.crypto=crypto;this.key=this.crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt','decrypt']);}
 async seal(owner,value){const iv=this.crypto.getRandomValues(new Uint8Array(12)),data=new TextEncoder().encode(JSON.stringify(value));const cipher=await this.crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode('worklog-sync:v1:'+owner)},await this.key,data);return{v:1,iv:base64(iv),ciphertext:base64(cipher)};}
 async open(owner,envelope){if(envelope?.v!==1)throw new Error('Unsupported credential envelope');const plain=await this.crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(envelope.iv),additionalData:new TextEncoder().encode('worklog-sync:v1:'+owner)},await this.key,bytes(envelope.ciphertext));return JSON.parse(new TextDecoder().decode(plain));}
}
