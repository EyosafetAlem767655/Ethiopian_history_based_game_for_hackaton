// Test-only fixture process. Production entrypoint never imports this module.
import {mkdirSync,writeFileSync} from 'node:fs';
process.env.DB_PATH=':memory:';process.env.PORT='2570';process.env.ALLOW_CHAIN_BROADCAST='false';
const store=await import('../apps/server/src/store');
const {freshCampaign}=await import('../packages/shared/src/missions');
const sessions:Record<string,unknown>={};
for(let id=1;id<=15;id++){const p=store.createProfile('Mechanic '+id,false);store.saveCampaign(p.id,{...freshCampaign(),completed:Array.from({length:id-1},(_,n)=>n+1),fellowship:id>=11});sessions[id]={token:store.token(p),profile:p};}
mkdirSync('output/tests',{recursive:true});writeFileSync('output/tests/browser-fixtures.json',JSON.stringify(sessions));
await import('../apps/server/src/index');
