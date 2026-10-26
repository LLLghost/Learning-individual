// Independent arithmetic ledger for the reviewed numerical problems, not a semantic reviewer.
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const {items}=JSON.parse(await readFile('content/course/assessments.json','utf8'));
const hour=3600, GiB=2**30, MiB=2**20;
const address=(10*2**24+8*2**16+3*256+190)>>>0, mask=(0xffffffff<<(32-26))>>>0;
const network=(address&mask)>>>0, broadcast=(network|(~mask>>>0))>>>0;
const ipv4=n=>[24,16,8,0].map(shift=>(n>>>shift)&255).join('.');
const values={
 R00:[24*GiB*8/(2e9*.75)],R01:[2+.04*120,2+.01*120],R02:[1/(.15+.85/12)],
 R03:[40+120,3*(40+120),3*40+120,40+120/3],
 R04:[(0o666&~0o022).toString(8).padStart(4,'0'),(0o777&~0o022).toString(8).padStart(4,'0')],
 R05:[Math.floor(512/(14+42)),512%56],R06:[ipv4(network),ipv4(broadcast)],
 R07:[25e9*.008/8/1e6,1400-20-20],R08:[10,4*10],R09:[.6*85+.4*155],
 R10:[8e9*(128/130)*8/8/1e9],R11:[640/800*100,800-640],
 R12:[32000*16/1024,32000*.0015],R13:[48-10240*4/1024,48*1024/4-10240],
 R14:[(9-1-2)*8,48e12/2**40,8e12/200e6/hour],R15:[5,35-20],
 R16:[100/(25*hour/1024-80)],R17:[5*18*.7/3,Math.floor(5/2)+1],
 R18:[1000/(2000-1000),1000/(2000-1800),1000/(2000-1980)],R19:[Math.floor((96-12)/7)],
 R20:[3e6*(1-.9995),1800/(3e6*(1-.9995))*100],R21:[3-1,124],R22:[Math.ceil(302/75)],
 R23:[Math.ceil(30/5),Math.ceil(30/5)*12],R24:[150000/100000],R25:[3,1],R26:[Math.floor(7.5/2)],
 R27:[(2*MiB-1966080)/1024,1966080/(2*MiB)*100],R28:[64-(8+16+16),Math.floor((64-40)/16)],
 R29:[8e9*(128/130)*4/8/1e9,16/4],R30:[5*Math.log2(8192),2**65/1e10/3.156e7],
 R31:[6*hour*45e-6*1000,.05/45e-6/60],R32:[7,15],
 R33:[.999*.9995*.9999*100,30*24*60*(1-.999*.9995*.9999)],
 R34:[(3*60+41)-(3*60+12),(4*60+20)-(3*60+12)],
 R35:[500000*.01*.04,500000*.10*.04],R36:[10+45+20]
};
let fields=0;
for(const [id,answers]of Object.entries(values)){
 const item=items.find(x=>x.id===id);assert.equal(item.fields.length,answers.length,id);
 for(let i=0;i<answers.length;i++){
  const actual=item.fields[i].answer,expected=answers[i];
  if(typeof expected==='string')assert.equal(actual,expected,id);
  else assert.ok(Math.abs(actual-expected)<=Math.max(['R30','R31','R33'].includes(id)?.051:1e-8,Math.abs(expected)*1e-8),`${id}: ${actual} != ${expected}`);
  fields++;
 }
}
console.log(`Arithmetic: ${Object.keys(values).length} reviewed problems, ${fields} fields match independent formulas and contracts. Tests do not replace semantic review.`);
