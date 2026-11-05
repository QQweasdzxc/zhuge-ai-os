const assert=require('assert');const C=require('../ZG-ERP/erp-seat-core.js');
const map={id:'m1',seats:[1,2,3,4,5].map(n=>({number:n}))};
const occ={'m1:5':{id:'o9',data:{name:'',public:true}},'m1:3':{id:'o1',data:{name:'既有'}},'m2:4':{id:'x',data:{name:'別張圖'}}};
const r=C.planNames({seats:{1:' 甲乙 ',2:'丙丁',3:'覆蓋',9:'不在圖上',x:'壞',4:'',5:'公共不寫'}},map,occ);
assert.deepStrictEqual(r.todo,[{seat:1,name:'甲乙'},{seat:2,name:'丙丁'}]);
assert.strictEqual(r.has,2);assert.strictEqual(r.off,1);assert.strictEqual(r.bad,2);
assert.ok(C.planNames({},map,occ).error);assert.ok(C.planNames(null,map,occ).error);
assert.deepStrictEqual(C.planNames({seats:{1:'甲'}},map,{}).todo.length,1);
console.log('seat-names ok');
