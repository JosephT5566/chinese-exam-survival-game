import { expect, it } from "vitest";
import { bank, questions, sections } from "../../src/questions/bank";
import { newPlayer, answer, explain, score, openChest, claimChest, nextQuestion } from "../../src/game/session";
import { drawChest, resolveScores } from "../../src/game/rewards";
function correct(p: ReturnType<typeof newPlayer>, ordinal = p.cursor) {
  const id = p.order[ordinal]!;
  return { id, right: p.choices[id]!.indexOf(questions.get(id)!.correctChoiceIndex) };
}
it("四單元各十題，所有選項有固定排列", () => {
  const p = newPlayer("小鹿");
  expect(new Set(p.order).size).toBe(40);
  for (const section of sections) expect(bank.filter((q) => q.sectionId === section)).toHaveLength(10);
  for (const id of p.order) expect([...p.choices[id]!].sort()).toEqual([0, 1, 2, 3]);
});
it("依精確門檻抽出寶箱，固定消耗兩次樣本", () => {
  const outcomes = [[0,0, "gain",20], [0.49,0.3,"gain",50], [0.49,0.8,"gain",80], [0.5,0,"steal",0], [0.7,0,"swap",0], [0.8,0,"loss",10], [0.99,0.5,"loss",20], [0.99,0.8,"loss",30]] as const;
  for (const [category,value,kind,amount] of outcomes) {
    const samples = [category,value]; let calls = 0;
    expect(drawChest(() => samples[calls++]!)).toEqual({kind,amount});
    expect(calls).toBe(2);
  }
});
it("寶箱開啟、領取與跨重載重試都不重發分數", () => {
  let p = newPlayer("小鹿"); const {id,right} = correct(p);
  answer(p,id,right,1000); expect(score(p)).toBe(0);
  nextQuestion(p,1000); expect(p.cursor).toBe(0);
  openChest(p,id,1,() => 0);
  p = JSON.parse(JSON.stringify(p));
  openChest(p,id,2,() => 0.99);
  expect(p.answers[id]?.chest?.box).toBe(1);
  claimChest(p,id,null,false,1001); claimChest(p,id,null,false,1002);
  expect(score(p)).toBe(20);
  nextQuestion(p,1002); expect(p.cursor).toBe(1);
  answer(p,id,right,1002); expect(Object.keys(p.answers)).toHaveLength(1);
});
it("錯題凍結三秒，詳解不加分且不能解除凍結", () => {
  const p = newPlayer("小鹿"), {id,right}=correct(p);
  answer(p,id,(right+1)%4,1000); explain(p,id); explain(p,id);
  nextQuestion(p,3999); expect(p.cursor).toBe(0); expect(score(p)).toBe(0);
  nextQuestion(p,4000); expect(p.cursor).toBe(1);
});
it("偷取不足額與零分、交換與單人替代均依當前分數結算", () => {
  expect(resolveScores({kind:"steal",amount:0},20,35)).toEqual({own:55,target:0,fallback:false});
  expect(resolveScores({kind:"steal",amount:0},20,0)).toEqual({own:20,target:0,fallback:false});
  expect(resolveScores({kind:"swap",amount:0},20,150)).toEqual({own:150,target:20,fallback:false});
  expect(resolveScores({kind:"loss",amount:30},20,null).own).toBe(0);
  expect(resolveScores({kind:"swap",amount:0},20,null)).toEqual({own:40,target:null,fallback:true});
});
it("有其他玩家時必須選別人，結算同時改變雙方分數", () => {
  const p=newPlayer("小鹿"), target=newPlayer("松果"), {id,right}=correct(p);
  p.totalScore=10; target.totalScore=150;
  answer(p,id,right,1000); openChest(p,id,0,()=>0.6);
  claimChest(p,id,null,true); claimChest(p,id,p,true);
  expect(p.pendingId).toBe(id);
  target.totalScore=60;
  claimChest(p,id,target,true);
  expect(score(p)).toBe(70); expect(score(target)).toBe(0);
  claimChest(p,id,target,true); expect(score(target)).toBe(0);
});
it("最後一題答對必須領寶箱，答錯必須等凍結結束", () => {
  for(const wrong of [false,true]) {
    const p=newPlayer("小鹿");
    for(let i=0;i<40;i++) {
      const {id,right}=correct(p);
      const now=1000+i*4000;
      answer(p,id,wrong&&i===39?(right+1)%4:right,now);
      if(i===39) expect(p.finishedAt).toBe(wrong?now+3000:null);
      if(!(wrong&&i===39)) { openChest(p,id,0,()=>0); claimChest(p,id,null,false,now); }
      nextQuestion(p,now+(wrong?3000:0));
    }
    expect(p.cursor).toBe(40); expect(p.finishedAt).not.toBeNull();
  }
});
