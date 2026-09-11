import { readFileSync, writeFileSync } from "node:fs";
import pg from "pg";
const env=k=>readFileSync("./.env","utf8").split("\n").find(x=>x.startsWith(k+"=")).slice(k.length+1).trim().replace(/^"|"$/g,"");
const S=env("SUPABASE_URL").replace(/\/$/,""),A=env("SUPABASE_ANON_KEY");
const db=new pg.Client({connectionString:env("MIGRATE_DATABASE_URL"),ssl:{rejectUnauthorized:false}});await db.connect();
const t=await(await fetch(`${S}/auth/v1/token?grant_type=password`,{method:"POST",headers:{apikey:A,"Content-Type":"application/json"},body:JSON.stringify({email:"familia@lifeclub.pt",password:"academia2026"})})).json();
const h={Authorization:`Bearer ${t.access_token}`,"x-academy-slug":"life-club","x-app":"family"};
const meus=await(await fetch("http://localhost:3000/api/athletes",{headers:h})).json();
const meu=meus[0];
const eq=(await db.query(`SELECT "teamId" FROM "TeamMembership" WHERE "athleteId"=$1 LIMIT 1`,[meu.id])).rows[0];
const quando=new Date(Date.now()+2*86400000);
await db.query(`DELETE FROM "AbsenceNotice" WHERE "sessionId"='ses_shot_aviso'`);
await db.query(`DELETE FROM "TrainingSession" WHERE id='ses_shot_aviso'`);
await db.query(`INSERT INTO "TrainingSession" (id,"academyId","teamId","startsAt","endsAt",venue,status,"updatedAt") VALUES ('ses_shot_aviso','acd_lifeclub',$1,$2,$3,'Campo n.º 2','SCHEDULED',now())`,[eq.teamId,quando,new Date(quando.getTime()+5400000)]);
writeFileSync("../../../../../AppData/Local/Temp/claude/c--Users-ruist-Desktop-club-man/04441657-7cc2-4f58-b007-7ff2edc42b48/scratchpad/hash4.txt",
  "#s="+encodeURIComponent(Buffer.from(JSON.stringify({accessToken:t.access_token,refreshToken:t.refresh_token,name:"Sandra Bragança"})).toString("base64")));
console.log("treino ses_shot_aviso criado para", quando.toISOString());
await db.end();
