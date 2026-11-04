/* Server-only adapter: requires existing caller approval BEFORE constructing.
 * Never exposes the service key or accepts owner/key assertions from the client.
 */
export class RowCustody {
 private client:any;
 readonly actor:string;
 readonly reservation:string;
 readonly operation:string;
 readonly keys:string[];
 constructor(client:any,actor:string,reservation:string,operation:string,keys:string[]){
  if(!actor||!reservation||!operation||!keys.length)throw Error('CUSTODY_CONTEXT_REQUIRED');
  this.client=client;this.actor=actor;this.reservation=reservation;this.operation=operation;this.keys=[...new Set(keys)].sort();
 }
 async rpc(name:string,args:Record<string,unknown>){const {error}=await this.client.rpc(name,args);if(error)throw Error('CUSTODY_'+name+':'+error.message)}
 async reserve(){await this.rpc('erp_reserve',{p_keys:this.keys,p_owner:this.actor,p_token:this.reservation})}
 async renew(){await this.rpc('erp_renew',{p_keys:this.keys,p_owner:this.actor,p_token:this.reservation})}
 async release(){await this.rpc('erp_release',{p_keys:this.keys,p_owner:this.actor,p_token:this.reservation})}
 async begin(){await this.rpc('erp_begin_write',{p_keys:this.keys,p_owner:this.actor,p_token:this.reservation,p_operation:this.operation})}
 async beforeSend(){const id=crypto.randomUUID();await this.rpc('erp_attempt_begin',{p_operation:this.operation,p_attempt:id});return id}
 async uncertain(id:string){await this.rpc('erp_attempt_result',{p_operation:this.operation,p_attempt:id,p_status:null})}
 async completed(id:string,status:number){await this.rpc('erp_attempt_result',{p_operation:this.operation,p_attempt:id,p_status:status})}
 async quarantine(){await this.rpc('erp_quarantine',{p_operation:this.operation})}
 async finish(retainKeys:string[]=[]){await this.rpc('erp_finish_write',{p_operation:this.operation,p_retain_keys:retainKeys})}
}
