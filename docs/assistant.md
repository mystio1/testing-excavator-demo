# The assistant

A voice and text assistant that operates the app on the owner's behalf. It is
built for someone who runs an excavator business and may not read comfortably
in any language, speaking Marathi, Hindi, English or a mix of the three —
including Hindi or Marathi typed in English letters.

That reader is the whole design constraint. Everything below follows from two
rules it creates:

1. **It never claims something it has not seen.** A save is confirmed only
   after the app's own screen shows the record. Someone who cannot read the
   screen back has no way to catch a false "done", so the app has to be the one
   checking.
2. **It never guesses.** A missing detail is a question. An ambiguous one is a
   question. Only the owner approves a write, and only against the exact values
   they were shown.

## How a turn works

```
 AssistantPanel (src/components/agent/assistant-panel.tsx)
        │  voice: MediaRecorder ──► POST /api/agent/listen ──► Whisper
        │  text:  the owner types
        ▼
 POST /api/agent { action: "message" }
        │  requireBusinessApi() · rate limits (DB) · zod
        ▼
 orchestrator.ts ── the turn loop
        │  askGroq() ── which capability, whose name, what number
        │  resolve()  ── allowlist: an id the registry does not hold is refused
        │  pickKnownFields() ── fields the workflow did not declare are dropped
        │  readDates() ── spoken days become real dates, or a question
        │  missingFields() ── anything absent is asked for, never invented
        ▼
 READ ──────────────────────────► a plan, straight away
 WRITE / SENSITIVE ─────────────► "Shall I save this?" + the exact values
        │                              │ owner says yes
        ▼                              ▼
                        POST /api/agent { action: "confirm" }
                               │  audit: assistant.approved
                               ▼
                        plan: [navigate, click, fill, select, submit]
                               ▼
 ui-controller.ts (in the browser) ── drives the REAL form, by data-agent-id
        │  no record matches, or several do → stop and ask. Never a coin toss.
        ▼
 POST /api/agent { action: "result", verified, screenText }
        │  audit: assistant.executed | assistant.unverified
        ▼
 WRITE  → "Done. It's saved."  (only because the screen said so)
 READ   → the answer, summarised from what is actually on screen
```

The assistant has no database access and no API of its own for changing data.
It drives the same forms a tap would, so every existing validation, audit entry
and tenant check applies unchanged. There is no privileged path.

## Why it is built this way

**A closed set of actions.** `UI_ACTIONS` has no `runScript`. The model cannot
ask for one because the vocabulary does not contain one. A workflow is looked
up in `workflows.ts`, never composed — the assistant does not work out how to
do a task.

**The registry is checked against the app.** Every control a `ready` workflow
names must exist as a `data-agent-id` in the source; `tests/agent/manifest.test.ts`
reads the tree and fails otherwise. Promoting a workflow without annotating its
controls breaks the suite rather than breaking in an owner's hands.

**Structure over instruction.** Prompt rules were tried first for several of
these and measurably failed. Where that happened, the app enforces the rule
instead:

| What went wrong | What a prompt rule achieved | What actually fixed it |
|---|---|---|
| Model put the site name in the customer field | nothing — identical output 3/3 runs | unmatched names become a question against the real record list |
| Model asked "which JCB?" when JCB was already said | nothing | worked examples in the prompt |
| Model renamed a field, so the value was dropped | n/a | field names are in the catalogue it is given |
| `"8 ghante chali"` written as an hour meter of 8 | rule + example worked | also caught by the meter being a required field |
| `"kal"` passed through as a literal date | n/a | `dates.ts` resolves it, or asks |

## Speech

Speech-to-text goes through the server (`/api/agent/listen`) so the API key
never reaches a browser. Replies use the browser's own voice, which costs
nothing and keeps the audio on the phone.

Three things make the difference between a transcript and a guess, all of them
measured rather than assumed:

- **The owner's own vocabulary** (`vocabulary.ts`) is sent as Whisper's
  `prompt`: their machine, operator, site and customer names. Without it,
  "Banda Patil" came back as "Bundapot" — and a name spelled differently
  matches no record, so a clear instruction ends in "I couldn't find that".
  Names go in exactly as stored, in Latin script even when the panel is in
  Hindi, because a transcript that writes "जेसीबी" matches no machine called
  "JCB".
- **A screen for invented text** (`transcript.ts`). Whisper never returns
  nothing. Measured against the live endpoint with a WAV of 32,000 zero
  samples — a file with nothing in it at all — it answered:

  | it wrote | `no_speech_prob` | `avg_logprob` |
  |---|---|---|
  | `"प्रदावाद प्रदावाद"` | 0.036 | **−0.204** |
  | `"जब आप आपको अपना व्यासाय का व्यासाय का उठान है, तो..."` | 0.036 | −0.443 |

  Read that twice. On a silent file Whisper reported a 3.6% chance of there
  being no speech, and a confidence *better* than it gives a clear real
  sentence (−0.42…−0.56). **No threshold can separate those**, so the
  confidence rules are only a floor, and a list of caption phrases cannot help
  either — these are freshly invented Hindi, different on every run, and one of
  them ended "...शुरू करते हैं", which is how an owner says "start it".

  What does the work is the **shape** of the words:
  - *a loop* — the same few words coming round again, counted directly rather
    than through Whisper's `compression_ratio`, which scored the sentence above
    at 2.35 against its own 2.4 threshold and a two-word chant at 1.36.
  - *reciting the vocabulary* — if nearly every word came from the prompt we
    supplied, we are being read our own names back. Measured from silence:
    `" KOMATO PC200, Tata Hitachi EX200, Banda Patil, Sagar Jadhav, Hinjawadi
    Phase 2, Saree Constructions."` — the owner's own records, which are
    exactly the values that get matched and acted on. The previous check was
    `prompt.includes(segment)` and missed it, because two names came back
    misspelt and a near-copy is not a substring.
- **The capture itself**: mono, noise suppression and automatic gain, an
  explicit Opus container, and the upload named from its real type — a Safari
  `audio/mp4` labelled `.webm` decodes as a broken microphone.
- **A different engine for Hindi and Marathi** (`transcribe.ts`). Whisper is
  good at English and bad at Marathi. Measured on 12 Marathi clips against
  reference transcripts, scored by word error rate:

  | engine | WER | speed |
  |---|---|---|
  | **IndicConformer RNNT** | **0.067** | 0.12× realtime (CPU) |
  | IndicConformer CTC | 0.101 | 0.07× realtime (CPU) |
  | Whisper large-v3 | 0.653 | 0.19× realtime (network) |

  Ten times fewer errors, and faster despite running on a CPU beside the app
  rather than over the network. And the errors are not just spelling — Whisper
  drops words and drifts into Hindi, writing `है` where the speaker said
  Marathi `आहे`, which is how a perfectly clear instruction ends up matching
  no record.

  So the engine is chosen **per language**: English stays on Whisper, which is
  better at it; Hindi and Marathi go to AI4Bharat's IndicConformer in a sidecar
  (`services/indic-asr`). If that sidecar is unset, slow or down, the turn
  falls back to Whisper instead of failing — a worse transcript is recoverable,
  because the values are read aloud for approval before anything is written. No
  transcript at all, in a yard, is the end of the conversation.

  The one thing it cannot do is take a vocabulary prompt. That is covered after
  the fact by the fold below and by `aliases.ts`.
- **Matching across scripts** (`script.ts`). The records say "Komatsu PC200"
  and "Banda Patil" because that is how they were typed. Marathi speech comes
  back in Devanagari, so the name handed to the matcher is "कोमात्सु" and the
  option on screen is "Komatsu PC200" — byte for byte, nothing in common. The
  instruction was understood, the name was heard correctly, and the owner was
  told "I couldn't find that" about a machine in their own yard.

  So both sides go through the same deliberately lossy fold before they are
  compared:

  | spoken | folded | stored | folded |
  |---|---|---|---|
  | पाटील | `patil` | Patil | `patil` |
  | वाकड | `vakad` | Wakad | `vakad` |
  | श्री | `shri` | Shree | `shri` |

  Long vowels collapse, `w`→`v`, `z`→`j`, and the inherent vowel is dropped at
  the end of a word (पाटील is "Patil", not "Patila"). None of it is correct
  romanisation and none of it is shown to anybody — it only has to be
  *consistent*, because it is applied to the spoken side and the stored side
  alike.

  Folding this hard will occasionally make two records look alike. That is
  safe here and the reason is structural: two matches is `ambiguous`, and
  ambiguous asks which one was meant. Folding too hard costs a question;
  folding too little costs "I couldn't find that" for a record that exists.

`Permissions-Policy` must keep `microphone=(self)`. An empty allowlist makes
the browser refuse without ever prompting, so no amount of tapping "Allow"
could help; `tests/unit/health-and-headers.test.ts` pins it.

## Quotas

Every tenant shares one Groq account, so a per-user limit protects nothing that
matters: a business with five signed-in users gets five times the allowance,
and one busy yard can spend the whole account's per-minute ceiling and hand
every other customer "Sorry, something went wrong". Three rings, narrowest
first — user, business, then a global backstop that keeps the shared account
alive. Numbers live in one place (`quota.ts`) and are env-overridable, because
the right values depend on the account's tier, which changes and is not
discoverable from the code. See `.env.example`.

## When it cannot answer

Three things, in order of how often they matter:

- **A retry**, for the model failing JSON mode. Measured: a one-word Marathi
  greeting returned `400 "Failed to generate JSON"`, non-deterministically.
- **A second model** (`GROQ_MODEL_FALLBACK`, unset by default), for a model
  name that stops existing — which happened once already on this account.
- **A breaker.** After a few consecutive service failures it answers
  immediately for a cooldown instead of making the owner wait out the full
  timeout on every attempt. Four taps of a 12-second wait is a minute of
  staring at a phone. Per-process and in memory on purpose: a breaker is a
  local judgement about what this instance has just seen.

Nothing retries a missing key or a rate limit — asking again cannot help and
only makes the owner wait twice as long for the same answer.

**And a path that needs no model at all.** The seven reads that take no values
are offered as tappable shortcuts, in the owner's own language, derived from
the registry rather than hand-listed (`shortcuts.ts`, pinned by
`manifest.test.ts`). They are a fast way to ask the commonest questions when
the model is up, and the only thing that works when it is not — which is why
the panel leads with them the moment the model says it cannot talk. A tap can
never reach a write: the allowlist is "reads with no fields", so a workflow
gaining a field drops out of it by itself.

## Saying a second thing

The panel keeps the last task's id and sends it with every message, so the
server knows an answer to "which operator?" belongs to the question it just
asked. `loadTask` therefore has to decide whether what was just said continues
that task or starts a new one, and for a long time it did not decide at all —
it returned the existing task whatever state it was in.

That is fine until a task finishes. `SUCCEEDED`, `FAILED` and `CANCELLED` have
no transitions out of them, deliberately, so the next sentence was handed to
`startExecuting`, `transition` refused it, and the route answered **500**:

    TaskTransitionError: A task cannot go from SUCCEEDED to EXECUTING

In other words the assistant answered the first thing you said and nothing
after it, until the panel was reloaded. It was found by running the app and
typing twice, and it had survived every suite — each test does a single turn,
and the tappable shortcuts go through `handleRun`, which always starts a fresh
task. Only a *typed or spoken* second sentence reached it, which is the
ordinary way the thing is used.

`acceptsNewInstruction` in `task-state.ts` now draws the line. A task is
continued only while it is still being composed — being understood, waiting on
a missing detail, waiting for approval. Once a plan has gone to the browser or
the task is finished, the next sentence is a new instruction and gets a task of
its own.

## When the connection drops

A yard has bad signal, so this is ordinary rather than exceptional. One browser
run's dev-server log had three requests to `/api/agent` ending in Node's own
`aborted` — the phone had gone away mid-request — while all 27 tests passed.
Two consequences, both fixed:

- **On the server**, that arrives looking like a fault and was answered with
  500 plus "unhandled error in route handler". `withApi` now recognises the
  exact abort signature and answers 499 (`isClientDisconnect`), so it is logged
  as a request, not a failure. Otherwise the error rate measures signal
  strength instead of correctness, and the first real fault arrives looking
  like more of the same. The check runs *before* the database-unavailable one,
  which also matches ECONNRESET — a disconnect must never be reported to the
  owner as a database outage.

- **In the panel**, `post()` returns null on any failure, and two call sites
  did nothing with it: the approval tap and the report of a plan that had
  already run. The owner heard **nothing**. For somebody who cannot read the
  screen, silence means nothing happened — so they say it again, and the yard
  gets two jobs, or two payments, for one instruction. That is the exact harm
  this feature exists to avoid, and it was reachable by losing signal at the
  wrong moment.

  Both now speak, and they say deliberately different things:

  | | |
  |---|---|
  | the request never got anywhere | "Nothing was saved. Please try again." |
  | the plan already ran in the page | "I could not check whether that saved. Please do not enter it again — ask me what I did." |

  The first is safe to promise because every write goes through a plan the
  *browser* runs afterwards: a request that never came back cannot have written
  anything. The second is the dangerous case — the record may well exist — so
  it points at `assistant.history.view`, which is a question the owner can ask
  out loud, instead of telling them to check a screen they cannot read.

  The approval card is **not** left up for a retry, because `confirm` is not
  idempotent: if the request did reach the server the task is already
  `EXECUTING`, and a second confirm would throw. Starting over is the honest
  offer. `tests/agent/lost-connection.test.tsx` holds all of this, and was
  checked by reverting the fix to confirm it fails without it.

## Switching it off for one business

`Business.assistantEnabled`, on by default. It exists because the alternative,
when the assistant does the wrong thing for ONE business, is a deploy that
takes it away from everybody while that case is worked out. Checked on the
server in every assistant route — the panel also hides itself, but that is
politeness, not a control, since an installed APK keeps a stale UI for months.

One exception: **withdrawing voice consent always works**, switch or no
switch. A permission you cannot take back while someone else holds a switch is
not one you really gave.

## Per-business configuration

- **Model.** `Business.assistantModel`, checked against an allowlist
  (`GROQ_MODELS_ALLOWED`) rather than taken as free text — an arbitrary value
  in a database row would be a way to point that business's spending at an
  unknown model, and the shared account pays for it. Null means the
  deployment's own choice. This exists so one customer can be tried on a
  better model, or moved off one answering them badly, without a deploy that
  moves everyone.
- **Vocabulary** needs no configuration: it is already derived per business
  from their own machines, operators, sites and customers (`vocabulary.ts`).
- **Bring-your-own key is deliberately NOT built.** It would mean storing a
  tenant's API key, which means encryption at rest, which means a new secret,
  a rotation story, and a decision about what happens when that secret is
  lost (every tenant's key unrecoverable) or leaks (every tenant's key
  exposed). This repository has no encryption-at-rest helper today, and
  introducing one quietly as a side effect of a feature would be the wrong way
  to acquire it. It is a decision to take deliberately, not a gap to fill in
  passing.

## Learning a mishearing

Whisper writes "Bundapot" where the owner said "Banda Patil", and a name
spelled differently matches no record — so a clear instruction ends in "I
couldn't find that". The vocabulary prompt reduces that; it does not remove it.

When it happens the owner is shown the records it could have meant **as
buttons**, not read a list to repeat back. Being asked to re-say a name the app
has just demonstrated it cannot hear is not a fix. A tap does three things: it
corrects this turn, it is remembered (`AgentNameAlias`) so the same mishearing
resolves by itself next time, and the right spelling joins the speech prompt
ahead of the raw record names, so Whisper is less likely to repeat it.

Nothing is learned from a guess. An alias is only written when the owner picked
a record from a list built out of their own data, it is scoped by kind (a
customer called "Patil" can never start resolving an operator), and it rewrites
the heard words to the record's own label — which then goes through normal
matching, so a record since renamed or archived still fails honestly.

Answering a "which one?" rewinds the task from EXECUTING to COLLECTING_DETAILS,
which the state machine normally forbids because after a submit the write may
have happened. It is safe here for a reason that is enforced rather than
assumed: only `select` and `pickFromList` can stop a plan that way, and
`manifest.test.ts` asserts no workflow places either after its submit.

## Interrupting it

Tapping the microphone while it is still speaking cuts it off. Until that
existed the tap started a recording while the device was talking **into** it,
so the clip contained the assistant's own voice — which Whisper then
transcribed: at best noise, at worst its own words coming back as though the
owner had said them. Done inside the recorder rather than at the three call
sites that start one.

A wake word is deliberately not built. It needs always-on listening, which
contradicts the consent model (§ voice notice) and would mean continuously
capturing a yard where other people are talking. Tap-to-interrupt is the
honest version of the same affordance.

## How long the owner waits

Every timeout used to be a number beside the code that used it, which is fine
until you total them. A read is four waits in a row — understand, navigate,
verify, summarise — and nothing said what that could reach. **It was 40
seconds.** Somebody holding a phone in a yard does not wait 40 seconds; they
tap again, and that is how one instruction becomes two records.

`budget.ts` holds all of them, and `budget.test.ts` adds them up and fails if
they stop fitting:

| | |
|---|---|
| understand (model) | 6 s |
| wait for a control | 4 s |
| settle its text | 0.4 s |
| summarise a read | 4 s |
| **confirm a save** | **8 s** — the most generous, deliberately |
| transcribe speech | 20 s, outside the turn budget |

The number that decides whether it feels broken is the **silent** part —
understand plus summarise, held to 10 s. While a form is visibly being filled
in an owner will watch; while nothing happens they will not. Verify gets the
most room because every other timeout costs a retry when it fires early, while
that one costs a wrong answer about whether the owner's record exists.

That is not theoretical. Confirm-a-save was briefly cut to 6 s to make the
totals balance, and the browser suite went red on a job that *had* saved: "I
couldn't confirm whether that saved" printed next to a correct record. The 8 s
is the figure a real run needed, and `budget.test.ts` now holds that floor so
the next person to balance the budget cannot quietly take it back.

## What a turn costs

Measured, not estimated: **~1,430 tokens** for a short turn, essentially all of
it the system prompt, which is re-sent every time. Trimming the capability
summaries and compressing the rules took the prompt from ~1,527 to ~1,247
tokens (−18%) with no rule dropped — the eval is what proves the trim cost no
accuracy, and is the reason it was safe to attempt at all.

Worth knowing about the shape of the bill: a **read costs two model calls**
(understand, then summarise what is on screen), so reads — the commonest thing
an owner does — are the most expensive turns.

## What the owner can see

`/settings/assistant` lists what the assistant saved, newest first: what it
was, the values as they were approved, and which of three things happened —
saved, not sure it saved, or approved with no result reported. The rows were
always being written (`trail.ts`); nothing surfaced them, so the owner had no
way to check up on something acting on their behalf. For a person who cannot
read the screen well enough to catch a mistake as it happens, looking
afterwards is the whole safety net.

It is also a registered capability (`assistant.history.view`), so "tumne kya
kiya?" opens it, and it appears among the tappable shortcuts automatically.
Deliberately **not** gated on `assistantEnabled`: if the assistant has just
been switched off because it did something wrong, that is exactly when the
owner needs to see what it did.

## Taking something back

"That was wrong" opens the page where the record lives and names it by the
values that were approved. It does **not** delete anything, and that is a
decision: the assistant drives the app's own forms and never calls its API, so
it never learns the id of the row a save created. The only way to delete "the
one I just added" would be to assume the newest row in a list is it — and on
an operator's money, a wrong guess there is worse than no undo at all, and
exactly the kind of harm someone who cannot read the screen could not catch.
So it gets them to the record, where a delete control already exists, and
leaves the removing to them.

## What it costs

Rate limits answer "how fast"; they cannot answer "how much". A yard can stay
inside every per-minute ring and still run a monthly bill nobody budgeted for.
`AgentUsage` holds one row per business per month, counted in what each service
actually bills in — tokens for the model, audio seconds for speech, because a
request count would be a comfortable number that is not the bill. Monthly caps
are env-set backstops; hitting one is said as a state of the account with an
end date, and the rest of the app is unaffected.

The cap is checked before a call and recorded after it, so the last call of the
month can cross the line. Deliberate: reserving tokens nobody has spent would
refuse work that would have fitted.

### The ceiling that is not ours, and is the real blocker

`AgentUsage` governs what this app spends. It cannot govern what the **Groq
account** is allowed to spend, and on the free tier that is the binding
constraint:

> `Limit 200000, Used 199860` — tokens per day, for the whole account.

Hit during development, by an eval run. At a measured ~1,430 tokens for a short
turn it works out to roughly **130–140 turns per day across every business
together**, and a read costs two model calls, so the commonest thing an owner
does is also the most expensive. One moderately busy yard could consume the
whole day's allowance before noon, and the second yard would meet a rate-limit
message all afternoon through no fault of its own.

Nothing in this repository can fix that, and it is not a bug to be found in the
code — it is a line on an account. Before this is put in front of paying
customers, one of:

- a **paid Groq tier**, which raises the daily ceiling (the simplest answer, and
  the one the per-business monthly caps were written to make affordable);
- **per-business API keys**, so one customer's usage cannot exhaust another's.
  Deliberately not built: it asks an owner who cannot read to obtain and paste
  a key, which is not a thing this user can do;
- **fewer model calls per turn** — a read's second call (the summary) already
  degrades gracefully to "I've opened it for you", so it could be dropped under
  pressure rather than failing the turn.

What the app *does* do when the ceiling is hit is fail honestly rather than
confusingly: the limit is not retried (asking again cannot help), the owner is
told it is a state of the account with an end date, and the tappable shortcuts
degrade rather than break. Precisely: a tap needs no model to *work* —
`handleRun` has no `ask` dependency at all, so the page opens and the read is
verified — and only the closing summary is a model call, which falls back to
"I've opened it for you — please have a look." So at the ceiling the owner can
still reach every no-value read; they just stop being told the answer out loud,
which for this owner is a real loss but not a dead app.

## Diagnostics, when support needs them

The audit trail answers "what changed". It cannot answer the question support
actually gets, which is *"why did it understand me that way"* — for that you
need the sentence and the model's reply to it.

Those are also the sensitive parts: the owner's words carry their customers'
names and phone numbers. So `AgentTurnLog` fills only while
`Business.diagnosticsUntil` is in the future — a window support opens, capped
at 24 hours, audited as SUPPORT with a reason. A timestamp rather than a
boolean because a flag can be left on by accident forever and a window closes
itself. Closing it **deletes what it collected**, or "off" would only ever have
meant "off from now on".

## Where a pending turn waits

In the database (`AgentTask`), not in process memory. It used to be a `Map`,
which was fine until it wasn't: Render restarts on every deploy and spins down
on the free tier, and more than one instance can serve the same owner — so the
owner tapped "Yes, save it" and was told *"That request has expired"*, on the
one action in the product that cannot happen without their approval. Swept
after 30 minutes. The store is injectable, so tests still run in memory with no
database and no clock.

## The audit trail

Because the assistant drives the real forms, the row that lands is written by
the same route a tap would use, with the same `OWNER` actor. Without a second
layer, nobody could later tell a job the owner typed from one the assistant
filled on their say-so.

So `trail.ts` writes the assistant's own entries, `entityType: "AgentTask"`,
`entityId` the task id:

| Action | When | Why it is there |
|---|---|---|
| `assistant.approved` | the owner said yes, before anything runs | the consent record, with the values as shown |
| `assistant.executed` | the screen confirmed it | closes the loop |
| `assistant.unverified` | it ran and the screen did not confirm | the important one: neither done nor safely undone |

Reads are not recorded — an entry for every "how many customers do I have"
would bury the ones that matter. The record-level entry stays authoritative for
*what changed*; this layer records *who asked for it and how*. It is
best-effort by construction, since the change happens in the browser later and
cannot share a transaction with it, and a failure is logged rather than allowed
to block the owner's work.

## What it covers

Eighteen capabilities are `ready` (11 reads, 6 writes, 1 sensitive) and two are
deliberately held back. The model is offered only the ready ones: `resolve()`
returns nothing else, so an id it invents or a draft it guesses at is refused
before any plan exists.

| Reads | Writes | Sensitive |
|---|---|---|
| `machine.list` | `work.start` | `operator.transaction.add` |
| `machine.status.view` | `work.stop` | |
| `machine.service.view` | `reading.add` | |
| `operator.salary.view` | `machine.allocate_operator` | |
| `operator.list` | `operator.leave.add` | |
| `customer.list` | `customer.create` | |
| `bill.list` | | |
| `business.dashboard.view` | | |
| `site.list` | | |
| `site.analysis.view` | | |
| `approvals.view` | | |

### Deliberately not offered

Registered as `draft`, so `resolve()` will not return them and the model is
never told they exist. Asking gets an honest "the app can't do that by voice".

- **`service.record.add`** — the form will not submit until at least one part is
  ticked from a searchable catalogue, each with a quantity and a cost. Picking
  parts out of a spoken sentence means guessing at a cost that goes against a
  machine's history, and the owner cannot read the result back to catch it.
- **`bill.create`** — a bill is the one document that leaves the business, made
  over several screens: which jobs to include, the rates that applied, which
  bank account, then a summary to check. Driving that for someone who cannot
  read the total back is the highest-risk thing the assistant could do and the
  lowest-value, since bills are made sitting down. It lists bills and reads
  what is unpaid instead.

Not registered at all, because the app has no such screen: machine expenses
(`ExcavatorExpense` has no UI or route), origin/destination on a job (a job has
one site), and an amount on a job (money is derived from hours × the site's
rate when a bill is made).

## Known limits

- **Verification compares a cheap fingerprint, not the record.** `verify`
  records the control's child count and text length before the save and waits
  for one of them to change (`stateOf` in `ui-controller.ts`); where the
  control did not exist at all, appearing is the proof. That closed the old
  hole — a failed save into a list that already had rows used to look verified
  — but two gaps remain, and they are not symmetric:
  - *False negative:* an edit whose result has the same child count AND the
    same text length reads as unverified. The owner is told to check, which is
    the harmless direction.
  - *False positive:* an unrelated re-render inside the verify window that
    changes the text length — a relative timestamp ticking over, say — counts
    as a change. Reading the saved record back from the database would close
    this one; the fingerprint is a DOM-level proxy for it.
- **A spoken ten-digit phone number** is the easiest thing to mishear. The
  approval card is the safeguard: it is read aloud before anything is written.
- **The Indic model needs a sidecar to be running.** Hindi and Marathi go to
  IndicConformer (see below), which is a separate service. When it is not
  deployed or cannot answer, those languages fall back to Whisper and its WER
  of 0.653 — the app keeps working, markedly less well. `INDIC_ASR_URL` unset
  is a supported configuration, not a broken one.
- **A fluent invented sentence can get past the transcript screen**, and
  nothing at that layer can stop it. Sampled over repeated live runs on a
  silent clip, Whisper produced a repeated word (caught), the vocabulary read
  back (caught), a one-word fragment `"झाल"`, and this:

      "प्रदान करने के लिए आपको प्रतिमान करना चाहिए."

  Eight words, no repeats, nothing from the prompt — indistinguishable from
  speech by any rule available here, and it arrived at `avg_logprob` −0.204.
  The defence is the layer below rather than a better screen: it names no
  machine, operator, site or customer, so the matcher finds no record and the
  turn ends in a question instead of a write. The cost is a wasted turn, not a
  wrong record, and `tests/eval/listen.test.ts` asserts exactly that narrower
  promise — that a phantom never comes back wearing the owner's own record
  names — rather than the one this code cannot keep.

## Testing it

Four layers, each answering a question the one below it cannot.

```
npx vitest run tests/agent      # the decisions: turn loop, policy, matching,
                                # dates, transcript, vocabulary, manifest,
                                # trail, route, and the DOM controller (jsdom)
npm run test:e2e                # the app: a real browser, a phone viewport,
                                # a real database
RUN_AGENT_EVAL=1 \
  npx vitest run tests/eval     # the model: does it still understand people
RUN_LISTEN_CHECK=1 \
  npx vitest run tests/eval/listen.test.ts   # the live speech endpoint
```

The last two are skipped by default and cost money per run.

**Decisions** (`tests/agent/*.test.ts`) are pure, with the model injected
(`AskFn`, `AnswerFn`), so no key is needed. `route.test.ts` is DB-backed: it
drives the real route with the real rate limiter and asserts the audit rows
actually land. `ui-controller.test.ts` runs under jsdom via an
`@vitest-environment` pragma; the suite default stays node.

**The real forms** (`tests/agent/real-forms.test.tsx`) render the app's own
dialogs — Base UI components, real controlled React state — run the real
planned operations against them, and assert on the body the API would have
received. What is on screen is not the claim; what gets saved is. These exist
because `setValue()` writing a DOM value on a *controlled* input only works if
React is genuinely told, and nothing written by hand can prove that.

**The browser** (`tests/e2e/*.spec.ts`, Playwright) covers what has no
equivalent anywhere else: the navigation spine every workflow starts with
(route change → fetch → list renders → the right card is clicked → the detail
page settles → a dialog mounts in a portal), `readControl`'s use of `innerText`
with real CSS applied, modal inertness, and a phone-sized screen. The model is
stubbed — a live one would be non-deterministic, cost money per run and hit the
account's per-minute limit — but the reply is built with the real
`planWorkflow()` from the real registry, so a test cannot pass against a step
order the app would never produce. Writes are asserted against the database.

```
npm run test:e2e                # starts next dev, or set E2E_BASE_URL
npx playwright test --ui        # to watch it
```

### The live speech check

`tests/eval/listen.test.ts`, skipped unless `RUN_LISTEN_CHECK=1`.

Everything that answers the original complaint — "things are not converted
properly in text from voice" — is otherwise tested against transcripts written
**by hand**. Hand-written fixtures prove the screen's logic. They cannot prove
that the live endpoint still accepts the fields we send, and they cannot prove
the screen catches what Whisper actually does.

So this makes one real call, with the same form fields in the same order as
`listen/route.ts`, and checks two things:

- **The wiring.** A dead model name, a rejected form field, an account that
  cannot use `verbose_json`: each breaks transcription completely while every
  other test in the repository stays green, because none of them make the
  request. This is the only check that would catch it.
- **The screen, against real output.** The clips contain no speech — digital
  silence, and the hiss a phone really records — which is the commonest thing a
  nervous first-time user produces: tap, hesitate, tap again. Whisper does not
  answer silence with silence; it invents a sentence, and when it has been fed
  the owner's own machine and operator names it often hands one of those back.
  What matters is that **nothing survives the screen**, so the panel says "I
  didn't catch that", which is the truth.

There is no speech in the clips on purpose. Generating real Hindi speech here
is not possible, and a silent clip tests the direction that actually causes
harm: an invented instruction is worse than no instruction. Accuracy on real
sentences is still measured by hand, and by the owner.

### The eval

`tests/eval/` holds a corpus of sentences an owner might say with the one
outcome correct for each, and a scorer that is strict about meaning and loose
about wording. It is **skipped by default** — it calls the real model, which
costs money per run and has a per-minute ceiling, and a suite that does that on
every commit is a suite people switch off.

```
RUN_AGENT_EVAL=1 AGENT_EVAL_OUT=docs/agent-eval-latest.txt npx vitest run tests/eval
```

It asserts a floor (80% overall and per language, 100% on safety, and zero
invented values), not perfection: this is a language model, and demanding 100%
means the suite fails on a sentence nobody cares about while a real regression
hides behind a lucky run. The per-category breakdown is the useful part.

The corpus self-checks DO run on every commit: no duplicate ids, every case
expects something, every expectation names a capability that still exists, and
every ready capability is covered at least once.

**It earned its place on the first run.** 83% overall, but writes at 58% and
dates at 33%, which exposed two bugs no other test could see:

- The model answered `clarify` whenever a required field was missing — and
  `clarify` carries no fields, so *everything the owner had just said was
  thrown away*. "Komatsu ka kaam shuru karo, Wakad site, meter 1200" became
  "which customer?" with the machine, site and meter discarded, and the owner
  had to repeat the whole sentence. The app asks for missing fields itself,
  one at a time, in their own language, and keeps the rest — so the prompt now
  prefers an action with partial fields.
- A one-word Marathi greeting returned `400 "Failed to generate JSON"` — the
  model failing JSON mode, non-deterministically (नमस्कार succeeded, नमस्ते
  did not). The owner saw "something went wrong" for saying hello. That one
  class of failure is now retried once; a wrong key or a rate limit is not,
  because repeating those only makes them wait twice as long.

After both fixes: **100%**, every language and every category, on what was
then a 53-case corpus. It has since grown to 55, and the most recent run scored
**54 of the 54 it was answered on**, with one case unanswered because the
account's breaker had tripped on rate limits.

That last detail is the thing to take from this section, because the harness
got it wrong: it reported the unanswered case as a *write* failure, dropping
that category to 92% and pointing at a prompt bug that did not exist. A number
is only as trustworthy as its denominator — see `isModelAtFault` in
`tests/eval/score.ts`, and the four layers below.

### What each layer actually caught

Worth recording, because it is the argument for having all four — and for
actually running the thing, which is where the last two came from:

| Bug | Found by | Why the cheaper layer missed it |
|---|---|---|
| `work.start` selected the customer, then filling the site **wiped it** — the job was filed against the site's own customer, silently | real forms | the step order is only wrong against the dialog's actual state logic |
| The start-work dialog copied its customer list into `useState`, freezing it at empty if opened before the fetch landed | real forms | needs the prop to arrive *after* mount, which only a render test does |
| A question asked mid-plan was rendered **behind the modal overlay** — inert, invisible, unanswerable | Playwright | jsdom has no modal inertness, so the panel looked perfectly reachable |
| `"kal"` reaching `<input type="date">` as a literal word | unit (dates) | — |
| `clarify` discarding everything the owner had just said, so they had to repeat a whole sentence | eval | no single-case test asks "did it keep what I told you"; only scoring a corpus showed writes at 58% |
| A Marathi greeting returning `400 Failed to generate JSON` | eval | non-deterministic, and invisible until the same phrase class was run repeatedly |
| The assistant being dead in the Android APK (relative `/api/agent`) | reading the build | no test runs the APK; `apiFetch` vs `fetch` is invisible to every suite |
| A double-tap on "Yes, save it" creating two jobs | reading the panel | `disabled={busy}` lags a render; no test taps twice in one frame |
| The vocabulary prompt handed back as speech **with two names misspelt**, so silence produced the owner's own machines, operator, site and customer | live speech | the echo check was `prompt.includes(segment)`, and no fixture ever mangled a name — only the real provider does that |
| The whole phantom screen being **blind on silence**: `no_speech_prob` 0.036 and `avg_logprob` −0.204 on a file of 32,000 zero samples, better than real speech scores | live speech | every transcript fixture was hand-written, so the confidence numbers in them were plausible rather than measured |
| The eval scoring a **service** error as the agent being wrong | reading the eval's own report | the fix for this existed, for 429s only; rate limits trip the breaker, and the breaker's error took the other branch |
| A dropped connection answered with **500** and "unhandled error in route handler" | reading the dev-server log during a green browser run | nothing asserts on the server's own log, and all 27 tests passed while it happened three times |
| The approval tap and the plan-result report both going **silent** when the request failed | reading the panel | `post()` returns null on failure and two call sites ignored it; a test would have to drop the connection mid-turn |
| **Every turn after the first one died with a 500** — `A task cannot go from SUCCEEDED to EXECUTING` | running the app and typing twice | every test did a single turn, and the tappable shortcuts go through `handleRun`, which always starts a fresh task; only a typed second sentence reached it |
| The JSON-mode **retry resending the identical request**, so it reproduced the same failure | the log, once it recorded the failed output's shape | with nothing but "Failed to generate JSON" logged, a retry that never worked looked the same as one that did |

Do not run two DB-backed vitest processes at once against the shared database:
`fileParallelism` is off within a run, but two runs open two Prisma pools and
together exceed the Supabase session pooler's 15-connection cap, which fails
every DB-backed file with "Can't reach database server".

`GROQ_MODEL` overrides the model, because which models an account can reach
varies and changes — a name that works today can 404 tomorrow, and that failure
looked exactly like a network blip until the upstream detail was logged.
