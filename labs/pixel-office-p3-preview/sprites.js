/* Zhuge P3 Lab: static, local, animated character art — not task telemetry. */
(() => {
"use strict";
const r=(x,y,w,h,c)=>'<rect x="'+x+'" y="'+y+'" width="'+w+'" height="'+h+'" fill="'+c+'"/>';
const crew={
"agent-pm":{hair:"#704432",shade:"#422d32",shine:"#aa795c",coat:"#eee2cd",edge:"#997e68",pants:"#566278",skin:"#f0c59e",tie:"#d8b166",spec:false,ponytail:false},
"agent-co":{hair:"#27384c",shade:"#18273d",shine:"#69849b",coat:"#79a6ce",edge:"#426e9a",pants:"#3b5369",skin:"#efbe9f",tie:"#e6e6dd",spec:true,ponytail:false},
"agent-gem":{hair:"#7876b4",shade:"#45456a",shine:"#b1afd5",coat:"#c5afd6",edge:"#7f72ae",pants:"#615a86",skin:"#f5cdb3",tie:"#ead7f3",spec:false,ponytail:true},
"agent-gpt":{hair:"#36c6c9",shade:"#245566",shine:"#b6ffff",coat:"#4a8497",edge:"#286071",pants:"#314f67",skin:"#e9c5a7",tie:"#9ff4e8",spec:false,ponytail:false,badge:true,hairStyle:"short"},
"agent-betty":{hair:"#9a5746",shade:"#573742",shine:"#d18b68",coat:"#db9b86",edge:"#a96770",pants:"#70516a",skin:"#f4c8aa",tie:"#f2d1ad",spec:false,ponytail:false,hairStyle:"long",clip:"#f4d27c"},
"agent-anan":{hair:"#354b42",shade:"#24373a",shine:"#769879",coat:"#83b39c",edge:"#4e806f",pants:"#405c57",skin:"#eed0b0",tie:"#e6cb86",spec:true,ponytail:false,hairStyle:"bob",book:"#e8b66c"},
"agent-kaka":{hair:"#d17a4e",shade:"#784744",shine:"#ffd08d",coat:"#df9d67",edge:"#a9575f",pants:"#66516f",skin:"#f5c5a0",tie:"#8fd2ad",spec:false,ponytail:false,hairStyle:"pigtails",clip:"#85dec7"}
};
const head=(p)=>[
r(12,14,26,23,p.shade),r(15,17,22,20,p.skin),r(11,8,29,12,p.shade),r(12,5,26,11,p.hair),
r(13,7,12,3,p.shine),r(29,7,5,3,p.shine),r(9,15,8,14,p.shade),r(36,12,6,14,p.shade),
p.ponytail?r(39,18,7,31,p.shade)+r(40,19,5,26,p.hair):"",
p.hairStyle==="long"?r(10,15,8,28,p.shade)+r(11,18,5,23,p.hair)+r(35,15,8,27,p.shade)+r(36,18,5,22,p.hair):"",
p.hairStyle==="bob"?r(10,16,8,18,p.shade)+r(11,18,5,15,p.hair)+r(34,15,9,19,p.shade)+r(35,18,6,15,p.hair):"",
p.hairStyle==="pigtails"?r(4,17,9,17,p.shade)+r(5,19,6,13,p.hair)+r(37,17,9,17,p.shade)+r(38,19,6,13,p.hair)+r(4,30,7,9,p.shine)+r(38,30,7,9,p.shine):"",
p.clip?r(33,12,5,4,p.clip):"",
r(18,25,3,3,"#24334c"),r(31,25,3,3,"#24334c"),r(16,30,5,2,"#e9a39b"),r(33,30,4,2,"#e9a39b"),
r(25,32,4,2,"#b87969"),p.spec?"<path d=\"M15 24H26V31H15Z M28 24H39V31H28Z M26 26H28\" stroke=\"#37465a\" stroke-width=\"2\" fill=\"none\"/>":""
].join("");
function render(p){
return ['<svg class="person-sprite" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 66" aria-hidden="true" shape-rendering="crispEdges">',
'<ellipse cx="25" cy="63" rx="17" ry="4" fill="#0b1421" opacity=".34"/>',
'<g class="sprite-leg-left">',r(14,47,10,12,p.pants),r(11,57,14,5,"#263248"),'</g>',
'<g class="sprite-leg-right">',r(28,47,10,12,p.pants),r(28,57,13,5,"#263248"),'</g>',
r(12,35,27,18,p.coat),r(12,35,5,18,p.edge),r(35,35,4,18,p.edge),
r(20,36,11,16,"#fff5de"),r(24,37,3,14,p.tie),
p.badge?r(31,39,5,5,"#9cf1e7")+r(32,40,3,3,"#285f70"):"",
p.book?r(34,43,10,11,p.book)+r(35,44,8,1,"#fff0c8")+r(35,47,8,1,"#fff0c8"):"",
'<g class="sprite-arm-left">',r(6,38,8,13,p.coat),r(8,48,6,5,p.skin),'</g>',
'<g class="sprite-arm-right">',r(37,38,8,13,p.coat),r(37,48,7,5,p.skin),'</g>',
r(20,31,10,7,p.skin),head(p),
r(15,40,3,8,"#ffffff66"),r(34,40,3,7,"#1a26384f"),'</svg>'
].join("");
}
for(const id of Object.keys(crew)){
 const fig=document.querySelector("#"+id+" .agent-figure");
 if(!fig)continue;
 fig.innerHTML=render(crew[id]);
 const cue=document.createElement("span");cue.className="activity-pip";cue.setAttribute("aria-hidden","true");
 fig.closest(".agent").appendChild(cue);
}
const kitty=document.querySelector("#cat .cat-body");
if(kitty)kitty.innerHTML=['<svg class="pet-sprite" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 55" aria-hidden="true" shape-rendering="crispEdges">',
'<ellipse cx="30" cy="52" rx="19" ry="4" fill="#071020" opacity=".4"/>',
'<g class="pet-tail">',r(49,23,5,25,"#101829"),r(49,16,9,10,"#172338"),r(53,10,6,9,"#172338"),'</g>',
r(13,30,37,18,"#121a2b"),r(16,33,32,13,"#29334a"),r(14,44,10,7,"#161c29"),r(40,44,10,7,"#161c29"),
r(11,14,37,26,"#141a2b"),r(14,15,31,23,"#28334a"),r(10,7,14,13,"#101627"),r(36,7,14,13,"#101627"),
r(14,10,7,7,"#604454"),r(39,10,7,7,"#604454"),
'<g class="pet-eyes">',r(18,24,9,8,"#edd471"),r(35,24,9,8,"#edd471"),r(22,25,3,7,"#252838"),r(39,25,3,7,"#252838"),'</g>',
r(29,34,4,3,"#e59aa6"),r(20,47,7,3,"#788496"),r(39,47,7,3,"#788496"),'</svg>'
].join("");
})();