import { detectPii } from "/home/user/lumiere-student-portal-v2/server/services/academic-assistant/pii";
import { answerFromRecord } from "/home/user/lumiere-student-portal-v2/server/services/academic-assistant/student-record";
const recs = ["Credits","Graduation","Electives","Documents","Support","Billing","Timeline","Program agreement","Checkpoints","Pace","Goal","Orientation sessions","Next tasks","Current courses"].map((label,i)=>({ref:`S${i+1}`,label,path:"/x",text:`${label} fact`}));
const qs: [string,"en"|"fr"][] = [
 ["How many credits do I still need?","en"],["What's most urgent?","en"],["Am I on track?","en"],["Which documents do I owe?","en"],
 ["Combien de crédits me faut-il encore ?","fr"],["Qu’est-ce qui est le plus urgent ?","fr"],["Suis-je dans les temps ?","fr"],["Quels documents dois-je fournir ?","fr"],
 ["How many credits do I have?","en"],["Where are my credits?","en"],["Why was my document rejected?","en"],["When is my next exam?","en"],["How much do I owe?","en"],["What is my balance?","en"],
 ["Combien de crédits ai-je ?","fr"],["Où en sont mes crédits ?","fr"],["Quand est mon prochain examen ?","fr"],["Pourquoi mon document a-t-il été refusé ?","fr"],["Combien je dois payer ?","fr"],["Explique-moi ma feuille de route","fr"],
 ["Can you explain photosynthesis?","en"],["Peux-tu m’expliquer le théorème de Pythagore ?","fr"],
];
for (const [q,l] of qs) { const p = detectPii(q); const f = answerFromRecord(q,l,recs as any); console.log(`${p.flagged?"PII-BLOCK("+p.kinds+")":"ok"} | ${f?"RECORD:"+f.cited.map(c=>c.label).join("/"):"no-intent→glossary/KB"} | ${q}`); }
