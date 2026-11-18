import { afterEach, expect, it, vi } from "vitest";
import { questions } from "../../src/questions/bank";
import { answer, explain, newPlayer, ranking, score, openChest, claimChest } from "../../src/game/session";
import { publish, setDuration, setStatus, expireRoom, readRoom, update, type Room } from "../../src/game/local";
import { remainingTime } from "../../src/game/rewards";
import { validRoom } from "../../src/game/validate";
function setup() {
  const p = newPlayer("松果");
  const room: Room = { code:"DEMO01",rulesVersion:2,durationMinutes:20,remainingMs:1200000,runningSince:1000,status:"running",players:[p],entries:[],updated:0 };
  const id=p.order[0]!,right=p.choices[id]!.indexOf(questions.get(id)!.correctChoiceIndex);
  return {p,room,id,right};
}
afterEach(() => {vi.restoreAllMocks();vi.unstubAllGlobals();});
it("拒絕越界、非整數、跳題與過期的答案",()=>{
  const {p,id,right}=setup();
  for(const pos of [-1,4,1.2,NaN]) answer(p,id,pos);
  answer(p,p.order[1]!,right); expect(p.answers).toEqual({});
  answer(p,id,right); answer(p,id,(right+1)%4);
  expect(Object.keys(p.answers)).toEqual([id]); expect(score(p)).toBe(0);
});
it("重載保留抽選結果、題序與凍結時間，詳解無獎勵",()=>{
  const {p,id,right,room}=setup(); answer(p,id,right,1000); openChest(p,id,2,()=>0);
  const saved:unknown=JSON.parse(JSON.stringify(room)); expect(validRoom(saved,room.code)).toBe(true);
  if(!validRoom(saved,room.code)) throw new Error("存檔無效");
  const restored=saved.players[0]!;
  expect(restored.order).toEqual(p.order); expect(restored.choices).toEqual(p.choices);
  expect(restored.answers[id]?.chest).toEqual(p.answers[id]?.chest);
  explain(restored,id); expect(score(restored)).toBe(0);
});
it("拒絕損毀、舊版與無效計時存檔",()=>{
  const {room,p,id}=setup(); expect(validRoom(room,room.code)).toBe(true);
  expect(validRoom({...room,rulesVersion:1},room.code)).toBe(false);
  expect(validRoom({...room,remainingMs:-1},room.code)).toBe(false);
  p.choices[id]=[1,1,2,3]; expect(validRoom(room,room.code)).toBe(false);
});
it("暫停保留餘時，恢復續計，時間到不能重新開始",()=>{
  const {room}=setup();
  expect(remainingTime(room,11000)).toBe(1190000);
  setStatus(room,"paused",11000); expect(room.remainingMs).toBe(1190000);
  expect(remainingTime(room,500000)).toBe(1190000);
  setStatus(room,"running",500000); expireRoom(room,1690000);
  expect(room.status).toBe("ended"); expect(room.remainingMs).toBe(0);
  setStatus(room,"running",1700000); expect(room.status).toBe("ended");
});
it("老師只可在大廳設定1到60整數分鐘",()=>{
  const {room}=setup(); room.status="lobby"; room.runningSince=null;
  for(const n of [0,61,1.2,NaN]) setDuration(room,n);
  expect(room.durationMinutes).toBe(20);
  setDuration(room,1); expect(room.remainingMs).toBe(60000);
  setStatus(room,"running",1000); setDuration(room,30); expect(room.durationMinutes).toBe(1);
});
it("新版儲存使用獨立命名空間並在Web Lock內重讀",async()=>{
  const data=new Map<string,string>([["literature-quest.v1.DEMO01",'old-save']]);
  vi.stubGlobal("localStorage",{getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>data.set(key,value)});
  const locks:string[]=[];
  vi.stubGlobal("navigator",{locks:{request:async(key:string,run:()=>unknown)=>{locks.push(key);return run();}}});
  expect(readRoom("DEMO01")).toBeNull();
  await update("DEMO01",room=>room.players.push(newPlayer("松果")),true);
  await update("DEMO01",room=>room.players.push(newPlayer("小鹿")));
  expect(readRoom("DEMO01")?.players).toHaveLength(2);
  expect(data.get("literature-quest.v1.DEMO01")).toBe('old-save');
  expect(locks).toEqual(["literature-quest.v2.DEMO01","literature-quest.v2.DEMO01"]);
});
it("跨分頁重複發布受十秒限制，結束強制發布最後排名",()=>{
  const {room,p,id,right}=setup(); const clock=vi.spyOn(Date,"now").mockReturnValue(1000);
  publish(room); answer(p,id,right); openChest(p,id,0,()=>0); claimChest(p,id,null);
  clock.mockReturnValue(10999); publish(room); expect(room.entries[0]?.score).toBe(0);
  setStatus(room,"ended",10999); expect(room.entries[0]?.score).toBe(20);
});
it("公開列表只包含分數與暱稱，同分依完成時間排序",()=>{
  const a=newPlayer("阿樹"), b=newPlayer("阿花"), c=newPlayer("阿草");
  a.finishedAt=200;b.finishedAt=100;
  expect(ranking([c,a,b])).toEqual(["阿花","阿樹","阿草"].map(nickname=>({nickname,score:0})));
});

it("錯題重載保留剩餘凍結且閱讀詳解不影響解鎖",()=>{
  const {p,room,id,right}=setup(); answer(p,id,(right+1)%4,1000);
  const restored:unknown=JSON.parse(JSON.stringify(room));
  expect(validRoom(restored,room.code)).toBe(true);
  if(!validRoom(restored,room.code)) throw new Error("存檔無效");
  const saved=restored.players[0]!;
  explain(saved,id); expect(saved.cooldownUntil).toBe(4000); expect(score(saved)).toBe(0);
});
