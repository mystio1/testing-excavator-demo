import { describe, expect, it } from "vitest";
import { KNOWLEDGE, MIN_SCORE, relevantKnowledge, searchKnowledge } from "@/lib/agent/knowledge";

/**
 * The guide is only as good as the entry it picks. These are questions an
 * owner actually asks, in the shapes they arrive in: the model's English
 * restatement (`topic`) alongside the owner's own words, which may be
 * Hinglish, Hindi or Marathi in Devanagari. Each must land on the entry that
 * answers it, inside the few that are sent to the model.
 */

type Case = { topic: string; said: string; want: string };

const CASES: Case[] = [
  { topic: "How do I generate a bill for a customer?", said: "bill kaise banate hai?", want: "bill.generate" },
  { topic: "How do I make a bill for a customer?", said: "Shree Constructions ka bill banao", want: "bill.generate" },
  { topic: "What kinds of bill are there?", said: "summary bill aur direct bill me kya fark hai", want: "bill.types" },
  { topic: "How is GST calculated on a bill?", said: "GST kaise lagta hai bill pe", want: "bill.calculation" },
  { topic: "How do I cancel a wrong bill?", said: "galat bill cancel kaise karu?", want: "bill.edit-delete" },
  { topic: "How are bill numbers given?", said: "bill number kaise aata hai", want: "bill.numbering" },
  { topic: "How do I share a bill on WhatsApp?", said: "bill whatsapp pe kaise bheju", want: "bill.share" },
  { topic: "How do I record a customer payment?", said: "party ka paisa aaya, kaise jama karu", want: "payment.record" },
  { topic: "Can I take an advance payment from a customer?", said: "customer se advance le sakte hai kya", want: "payment.correct" },
  { topic: "Why is the customer pending amount so high?", said: "पेंडिंग इतके जास्त का दाखवते?", want: "customer.pending" },
  { topic: "How is profit calculated?", said: "profit kaise calculate hota hai?", want: "dashboard.profit" },
  { topic: "What do the dashboard revenue and received figures mean?", said: "dashboard pe revenue aur received ka matlab", want: "dashboard.cards" },
  { topic: "Why do the totals differ between screens?", said: "site analysis aur dashboard ka pending match nahi karta", want: "reports.mismatch" },
  { topic: "How is operator salary calculated?", said: "operator ki tankha kaise nikalti hai", want: "salary.how" },
  { topic: "Why does the salary tab show a different amount than overview?", said: "salary tab aur overview alag amount", want: "salary.screens-differ" },
  { topic: "How is an operator advance deducted from salary?", said: "operator ko advance diya to salary se kaise katega?", want: "operator.money" },
  { topic: "How do I record operator leave?", said: "operator chutti pe gaya", want: "operator.sessions-leave" },
  { topic: "How does an operator join the business?", said: "naya operator kaise jode", want: "operator.add" },
  { topic: "How do I add a machine?", said: "nayi JCB kaise add kare", want: "machine.add" },
  { topic: "How do I mark a machine as broken down?", said: "machine kharab ho gayi, breakdown kaise dale", want: "machine.status" },
  { topic: "How do I change the operator of a machine?", said: "machine ka operator badlo kaise", want: "machine.operator" },
  { topic: "Why did the hour meter go backwards?", said: "meter galat ho gaya peeche chala gaya", want: "machine.hour-meter" },
  { topic: "How do I start work on a machine?", said: "kaam shuru kaise karte hai", want: "work.start" },
  { topic: "How do I stop work and complete a job?", said: "kaam band kaise kare", want: "work.stop" },
  { topic: "How do I record a day's work?", said: "aaj ka kaam kaise daalu", want: "work.daily-reading" },
  { topic: "How are hours calculated?", said: "ghante kaise nikalte hai", want: "work.hours-calculation" },
  { topic: "How do I correct a wrong reading?", said: "galat reading kaise sudhare", want: "work.correct" },
  { topic: "What happens when I reject an operator reading?", said: "operator ki reading reject karne par kya hota hai", want: "approvals" },
  { topic: "Why can't I start work on this machine?", said: "start work nahi ho raha, operator ne shuru kiya tha", want: "approvals.operator-job-issues" },
  { topic: "How do I record diesel?", said: "diesel kaise dalu", want: "diesel.recording" },
  { topic: "How is the diesel average calculated?", said: "डिझेल ऍव्हरेज कसे काढतात?", want: "diesel.average" },
  { topic: "How do I deduct diesel supplied by the customer?", said: "party ne diesel diya, bill me kaise kate", want: "diesel.customer-supplied" },
  { topic: "How do I record a service?", said: "JCB ka service kar diya, entry karo", want: "service.add" },
  { topic: "How does the app decide when the next service is due?", said: "service kab due hota hai", want: "service.due" },
  { topic: "How do I change a site's hourly rate?", said: "site ka rate badalna hai", want: "site.rates" },
  { topic: "How do I create a site?", said: "nayi site kaise banaye", want: "site.manage" },
  { topic: "What does the site analysis report show?", said: "site analysis report", want: "site.analysis" },
  { topic: "How do I delete a customer?", said: "customer hatao", want: "customer.manage" },
  { topic: "Is there an expenses page?", said: "kharcha kaha daalu", want: "app.not-available" },
  { topic: "How do I reset my password?", said: "password bhool gaya", want: "account.login" },
  { topic: "Where do I add my bank account and logo for bills?", said: "bill pe logo aur bank account", want: "settings" },
];

describe("the guide finds the entry that answers the question", () => {
  for (const c of CASES) {
    it(`${c.want} ← "${c.said}"`, () => {
      const found = relevantKnowledge([c.topic, c.said]).map((e) => e.id);
      expect(found, `top results: ${JSON.stringify(searchKnowledge([c.topic, c.said], 5).map((h) => [h.entry.id, +h.score.toFixed(2)]))}`).toContain(c.want);
    });
  }

  it("ranks the right entry first for most questions, not just somewhere in the top three", () => {
    const first = CASES.filter((c) => searchKnowledge([c.topic, c.said], 1)[0]?.entry.id === c.want).length;
    // Being in the top three is what the answer needs; first place on most is
    // the sign the ranking is sound rather than lucky.
    expect(first / CASES.length).toBeGreaterThanOrEqual(0.8);
  });

  it("finds entries from the owner's words alone when there is no restatement", () => {
    expect(relevantKnowledge(["bill kaise banate hai"]).map((e) => e.id)).toContain("bill.generate");
    expect(relevantKnowledge(["operator ki tankha kaise nikalti hai"]).map((e) => e.id)).toContain("salary.how");
  });
});

describe("it does not pretend to know what is not in the guide", () => {
  const unrelated = [
    ["What is the weather today?", "aaj mausam kaisa hai?"],
    ["Who won the cricket match?", "cricket match kaun jeeta"],
    ["Tell me a joke", "ek joke sunao"],
    ["What is the capital of France?", "france ki rajdhani"],
  ];
  for (const [topic, said] of unrelated) {
    it(`finds nothing for "${said}"`, () => {
      expect(relevantKnowledge([topic!, said!])).toEqual([]);
    });
  }

  it("returns nothing for an empty or stop-word-only question", () => {
    expect(relevantKnowledge([""])).toEqual([]);
    expect(relevantKnowledge(["kya hai", "how is it"])).toEqual([]);
  });
});

describe("the guide itself", () => {
  it("has unique ids, and every entry has a title, keywords and a body", () => {
    const ids = KNOWLEDGE.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of KNOWLEDGE) {
      expect(e.title.length, e.id).toBeGreaterThan(5);
      expect(e.keywords.length, e.id).toBeGreaterThan(2);
      expect(e.body.length, e.id).toBeGreaterThan(80);
    }
  });

  it("keeps each entry short enough to be read aloud and cheap to send", () => {
    // Three entries go with every help question, and the shared account pays
    // per token. A sprawling entry is also a sign it is two topics.
    for (const e of KNOWLEDGE) expect(e.body.length, e.id).toBeLessThan(900);
  });

  it("does not describe features this build does not have", () => {
    // Present in the newer product but not in this one. Mentioning them is
    // allowed only to say they are missing (app.not-available, diesel entries).
    const absent = [/expenses page/i, /diesel price/i, /daily summary/i, /partially completed/i, /machines by site/i];
    for (const e of KNOWLEDGE) {
      if (e.id === "app.not-available") continue;
      for (const pattern of absent) {
        const hit = pattern.exec(e.body);
        if (hit) expect(e.body, `${e.id} mentions "${hit[0]}"`).toMatch(/no |not |nothing|cannot/i);
      }
    }
  });

  it("uses a threshold that unrelated questions stay under", () => {
    for (const q of ["weather today", "cricket score", "recipe for tea"]) {
      expect(searchKnowledge([q], 1)[0]?.score ?? 0).toBeLessThan(MIN_SCORE);
    }
  });
});
