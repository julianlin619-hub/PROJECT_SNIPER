export const DEFAULT_EDIT_PROMPT = `

<format>
This is a call-in show. The transcript has two speakers:
- **Speaker 0 (Host)** — the advisor. Asks diagnostic questions and delivers the insight or solution.
- **Speaker 1 (Caller)** — the person calling in with a business problem or goal.

(Labels may appear as "Host" / "Caller" if names have been resolved.)
</format>

<task>
Given a raw conversation transcript with numbered utterances, produce per-utterance editing decisions that follow a HOOK → MEAT → PAYOFF arc.

You may only KEEP, REMOVE, or TRIM existing text — never add new words, fabricate, or rearrange the order of the transcript.
</task>

<word_budget>
Aim for 300 to 400 words of kept/trimmed content in the final output.
</word_budget>

<process>
Follow this exact order:

### Phase 1: Build the HOOK
The hook is always grounded in the **Caller's** opening lines. It must convey:

1. **Who is the caller?** (role, business type — can be brief or spread across a few lines)
2. **What is their core problem or goal?** (include numbers where available: revenue, targets, lead counts, close rates, price points)
3. **What are the stakes?** (why does this matter?)

Start from the Caller's first substantive lines. Do not open the clip with the Host. The hook does not need to be a single condensed block — it can emerge across several short kept or trimmed lines. Protect the numbers and business context. Do not cut them in the name of tightening the opening.

### Phase 2: Identify the PAYOFF(s)
The payoff is almost always delivered by the **Host** — their key insight, reframe, diagnosis, or concrete action plan. Look for the Host's strongest moment: a sharp diagnosis, a surprising reframe, a specific framework, or a direct instruction.

A clip can have 1–2 payoffs. Keep both if the transcript genuinely contains two distinct valuable Host insights that each stand on their own.

Each payoff must:
- Be a concrete statement, not vague advice
- Be understandable to a viewer who has seen the hook
- Have contrast or tension (contrarian insight, sharp reframe, surprising number, actionable framework)

Remove everything after the last payoff lands. Nothing trails.

### Phase 3: Connect the MEAT
The meat is everything between the hook and the payoff(s). Keep the lines that build toward the insight — including full analogies, frameworks, and diagnostic exchanges if they are needed for the payoff to land. Do not reduce to the bare minimum if that would make the insight feel abrupt or unsupported. Cut tangents, repeated examples, and side stories that make the same point twice.

### Phase 4: Final read-through
Read only the KEEP and TRIM lines in sequence as a first-time viewer would hear them. Check:
- Every sentence is grammatically complete and reads as proper English
- No line starts or ends mid-thought
- No jarring jumps between kept lines
- The clip opens cleanly and ends on the last payoff

Fix anything that reads awkwardly before outputting.
</process>

<editing_rules>
- **FILLER RULE:** Never KEEP a line whose entire content is filler or discourse markers (Okay, Yeah, Mhmm, Right, So, Now, Perfect, Alright, Great, Sure, Yep, Cool, Absolutely, Wow, Uh, Um, Oh). These must always be REMOVE. If a filler word opens a substantive sentence, TRIM to start from the substantive part.
- **MERGING RULE:** You may merge adjacent utterances from the same speaker into one TRIM decision by combining their text. Use the FIRST utterance's index for the TRIM and REMOVE the subsequent ones. Every index must still have a decision line.
- **FRAGMENT RULE:** If an utterance consists entirely of incoherent fragments, crosstalk, or noise, REMOVE it. After trimming, if an utterance would be left as a fragment that cannot stand alone — REMOVE it instead.
- Remove filler words, false starts, and stutters within kept lines.
- Tighten sentences — keep them punchy while preserving the speaker's voice.
- When multiple examples illustrate the same point, keep only the strongest one.
</editing_rules>

<output_format>
Use the submit_edit_decisions tool to submit your decisions. For each utterance, provide one decision object with:
- \`index\`: the utterance index
- \`action\`: "KEEP" (use as-is), "REMOVE" (cut entirely), or "TRIM" (replace with trimmed text)
- \`trimmed_text\`: required when action is "TRIM" — the shortened text using ONLY words from the original utterance

Rules:
- Every index from the input MUST have a decision (no gaps)
- TRIM trimmed_text must use ONLY words from the original utterance (no new words, no fabrication)
- Decisions must be in index order
</output_format>

<examples>

<example>
RAW TRANSCRIPT:

[0] Speaker 0: Rihard Vandenburg. That's a great name. Vandenburg. How much do I have to pay for that time? It would be free if you're a qualified lead. Johal, Jesus, $40.36. I love this. $5.01 $0.01 calls is a bit too much. If you have no leads, what are we talking about? If you if you get to the point where like, oh my god, I don't have time to do these five one zero one calls. Guess what? We solved the fucking lead problem. Alright. Alright. We got somebody up. What would it take to become a luxury real estate developer as an architect with no capital? Hello?
[1] Speaker 1: Hi.
[2] Speaker 1: Hey. Alright. Revenue, business, and problem. Yeah. Let's rock. I can tell you that. I mean, I teach crafters and mostly women, 45,
[3] Speaker 0: how to make You teach crafters? For themselves. Crafters make stickers. Stickers.
[4] Speaker 1: Okay. Love it. I love this. This is great. Okay. They can stick it for themselves or for their family or to sell. Right. So my business is made it did over 7 figures last year and I found for you. All low tickets.
[5] Speaker 0: You. Okay. So you made a million Okay.
[6] Speaker 1: Yes.
[7] Speaker 0: Amazing. $7
[8] Speaker 1: and 270.
[9] Speaker 1: Okay. And the main continuity I have is the is a membership. It's my main $27
[10] Speaker 1: a month or 270 per year membership.
[11] Speaker 1: I really wanna be at 3,000,000
[12] Speaker 1: USD per year, but my constraint, I think, is thirty day cash. So on the main membership funnel that I have for ads, I collect about $60 in the first thirty days per new member.
[13] Speaker 1: Okay. But when I base the numbers on my past recent launches, it's probably costing me about $90 to acquire them with meta ads. So I just feel like Mhmm. I can't scale profitably. What's churn? What's What's churn? What's LTV? LTV?
[14] Speaker 1: So churn is 93%, and LTV bounces a little bit depending on launches, but it's around $300.
[15] Speaker 0: Hold on. So $27 divided by 7%. Right? Okay. So $3.85 is so $3.85 is true LTV. Okay. That's fine. And you're so big picture, just so we're clear, you're spending 90 and you're making $3.85. Right?
[16] Speaker 1: Well, $3.85 is across the entire like, my all of my members. So I have worked out the LTV specifically for the ad funnel.
[17] Speaker 0: Okay. Are you on school?
[18] Speaker 1: This membership is not on school, but I do have a smaller membership that is on school. Okay. Because on school, you could it does by cohort. So you can actually see cohorts by month. So you can see when you have your launch month, and you could follow that cohort to see its Yeah. I need to start tracking this. I can do it myself. I just haven't.
[19] Speaker 0: Yeah. It's a pay I mean, we spend a zillion to to do that on school. Anyways, not a school ad. Yeah. Okay. Yeah. So you're at you're at $60 is what you're collecting in cash. It's costing you 90. You're not sure on LTV, but you feel comfortable saying $300.
[20] Speaker 0: Yeah. Yeah. That sound fair? Okay. Got it. And the problem is that it takes you two months to break even rather than one. The way that I've worked it out, and I I may not have all of my number
[21] Speaker 1: Here, but that it takes longer than two months. So Okay. Yeah. Yeah. I trust you. I trust you. It feels like because I'm I'm all good with with, you know, paying in advance and taking a hit on ads to get like, to recoup the cash, but it feels to me from what I've worked out, but it's probably more like six months. Okay. Got it. So when you're making the offer and you do and when you're running the ads funnels, running to a webinar or running to a five day event, what is it running to? That's five k well, three, four, five day event. So I'm let's gonna go up one right now. No. You're good. So it's a paid it's a paid event. Yeah.
[22] Speaker 0: Okay. What's the, what's the offer that you sell at the event? Price point? The paid event is $10, and then the offer is the 27 a month or $2.70 a year.
[23] Speaker 1: And then I've kind of switched in and out different kinds of upsells to try and increase the car value.
[24] Speaker 0: Okay. And so what percentage are taking the prepayment versus the 27?
[25] Speaker 1: About 10% take annual.
[26] Speaker 0: Yeah. It's because you're I mean, if you someone if somebody has the offer between the two and you're giving them 16% off, it's not a what bonuses do you add to the $2.70, or is it literally the same offer with the discount? Previously, yeah, I've done joining bonuses every day of the event, but I I haven't restricted it to members only, and I feel that I'm missing a trick there. And I've considered because I'm in the middle of a launch right now. I could implement an annual member's
[27] Speaker 1: bonus right now even for existing members to upgrade. So, otherwise, apart from the two months three, they get nothing else extra.
[28] Speaker 0: I honestly think you you could you can very easily solve this with two steps. Alright? So here they are. Mhmm. Number one is that when you're doing a five day selling event, you need to sell the expensive thing.
[29] Speaker 1: Yeah.
[30] Speaker 0: So your fear is I'm gonna I wanna sell this recurring thing because I don't wanna lose anybody. But the reality is that if you have five days with people, you could to a consumer audience is what you're selling to. 300 to 600 is the impulse purchase window for a consumer. 300 is the low end, 600 is the high end. That's your range. You could probably go up a little bit, and you'd still probably you'll make more money at 5 or 600. I'm just telling you right now, if you wanted to go crazy. I'm just telling you. You would. But you need to sell the annual upfront. Alright? That's number one. And what I want you to do is come up with one to two big bonuses that are gonna be annual exclusive. Okay?
[31] Speaker 1: Yeah.
[32] Speaker 0: Now after the event is over, what you're gonna do is you're gonna do a scoop up campaign. So it's five days, and you're gonna retarget everybody who saw the ads directly to your $27 purchase page. That's 27 per month, and you're just gonna remove the bonuses.
[33] Speaker 1: Yeah.
[34] Speaker 0: That's it. That'll fix your cash issue. You wanna you can do it? I like that plan. It's something that I haven't focused on enough before.
[35] Speaker 1: I have tried increasing the price a few times to a bit higher, not even in the 300 to 600 range. Yeah. But I feel it because I haven't offered a big enough bonus package, that's definitely it hasn't helped. So I can absolutely do this.
[36] Speaker 0: I love this for you. Now let me give you a little a little something else. There's probably some sort of what I'll call physical product premium that you can add to this. So are there any is there, like, a kit? It you can't do it for this one, but for next one. Is there any kind of, like, physical thing that you can give them, like, the the paper, the printer, the you know, that kind of stuff?
[37] Speaker 1: There are so many things typically that I could put together. There are so many things. I have no clue about doing this. Maybe Vantage is a good place for me to ask because it's something that I know has worked well otherwise in the creative space for friends. So I'm sure that's something I could do. I just wouldn't know where to sell. So I would say this. If if I were you, what I would end up doing is I would sell them the printer
[38] Speaker 0: with the pay you can't do it by this time because you're, like, two days away from pitching. So do what I said first. You know, add the annual with a bonus. Mhmm. But you will dramatically increase your conversions if you add a physical product that makes the makes this pitch tangible. Because the thing is is people need people have you heard, like, people need a reason but have an excuse? Alright? The idea is that, like, these ladies, I'm assuming they're ladies, 45 plus, want to they want to buy it. Right? They have a reason, but they need an excuse. The excuse to legitimize the person they can go to their husband, or their spouse, whatever, is they say, hey. But I got this thing which I'm gonna use to generate money or like, they get something, not just like a login. So the a consumer's willingness to purchase goes up dramatically if it's physical. And so I think you'd actually be able to push a thousand dollar price point if you included the physical thing.
[39] Speaker 1: Yeah. My head is swirling now with so many different physical things that I can Yeah. Like, put together. Even if it's only a one thing to test first, like yeah. Yeah. I've never even considered doing that. So say that's all. Two because I don't wanna overwhelm. Step one, add the annual. Make that the only offer available. I wanna be clear. The only offer available is the annual with the bonuses. You cart close. Mhmm. After the cart closes, then you do a mop up campaign. That's the $27 a month thing, but it doesn't have these two key bonuses. Okay. So annual only at the next launch. Yes. And then after the launch completes, then I offer monthly as well, but with none of the bonuses. So, basically, you do two car closes. Car close one, and then you do car close two. Yeah. Okay? Yeah. And you can like, let's say there's three bonuses. You remove two. You keep one at the 27, so that allows you to car close the second one, and then you have your normal everyday activities that don't include those three Yeah. Cool. And if people ask for monthly, because they would, do I do I just say no?
[40] Speaker 0: Well, I would just say like throw at them. I I would say like, we have options for monthly, but you're not gonna get these bonuses that I just spent all this time talking about, and they're gonna be that sounds fun. Yeah. I really wanna be open and honest. Yeah. That's Of course. You. Do not lie, but you can make it less convenient to purchase the thing you don't want them to purchase.
[41] Speaker 1: Yeah. Yeah. Cool. I thought that helps. Okay. That's really awesome. Thanks so much. You bet. Talk soon. I'll see you inside the group. Alright. Cheers. Bye. Cheers.
[42] Speaker 0: Johnny, like that one? Cheers. It's one of your people. I know. You're like, how am I saying a Chinese man has an Australian background? Well, because he's from Australia. It's very mixed up. Okay. This is awesome advice. Thank you, Haley. I appreciate that. Izzy, what's up? I have two women in the chat. Holy cow. What a day. My 87% male audience. Izzy, I appreciate you guys. We're making a difference. We're doing it. We're doing it, guys. Alright. What else we got?

DECISIONS:

[0] REMOVE
[1] REMOVE
[2] TRIM: I teach crafters and mostly women, 45,
[3] KEEP
[4] TRIM: So my business is made it did over 7 figures last year
[5] REMOVE
[6] REMOVE
[7] REMOVE
[8] REMOVE
[9] REMOVE
[10] REMOVE
[11] KEEP
[12] TRIM: USD per year, but my constraint, I think, is thirty day cash.
[13] TRIM: So I just feel like Mhmm. I can't scale profitably.
[14] REMOVE
[15] REMOVE
[16] REMOVE
[17] REMOVE
[18] REMOVE
[19] TRIM: So you're at you're at $60 is what you're collecting in cash. It's costing you 90. You're not sure on LTV, but you feel comfortable saying $300.
[20] REMOVE
[21] REMOVE
[22] REMOVE
[23] REMOVE
[24] REMOVE
[25] REMOVE
[26] REMOVE
[27] REMOVE
[28] TRIM: I honestly think you you could you can very easily solve this with two steps. Number one is that when you're doing a five day selling event, you need to sell the expensive thing.
[29] KEEP
[30] TRIM: So your fear is I'm gonna I wanna sell this recurring thing because I don't wanna lose anybody. But the reality is that if you have five days with people, you could to a consumer audience is what you're selling to. 300 to 600 is the impulse purchase window for a consumer. 300 is the low end, 600 is the high end. That's your range. You could probably go up a little bit, and you'd still probably you'll make more money at 5 or 600. But you need to sell the annual upfront. Alright? That's number one.
[31] REMOVE
[32] REMOVE
[33] REMOVE
[34] REMOVE
[35] REMOVE
[36] TRIM: Now let me give you a little a little something else. There's probably some sort of what I'll call physical product premium that you can add to this.
[37] REMOVE
[38] TRIM: So the a consumer's willingness to purchase goes up dramatically if it's physical. And so I think you'd actually be able to push a thousand dollar price point if you included the physical thing.
[39] TRIM: Cool. And if people ask for monthly, because they would, do I do I just say no?
[40] TRIM: Well, I would just say like throw at them. I I would say like, we have options for monthly, but you're not gonna get these bonuses that I just spent all this time talking about, and they're gonna be that sounds fun. Do not lie, but you can make it less convenient to purchase the thing you don't want them to purchase.
[41] REMOVE
[42] REMOVE
</example>

<example>
RAW TRANSCRIPT:

[0] Speaker 1: My name is Matthew. I sell premium catering experiences to proper clients looking to celebrate milestone events in Sydney. We grew about 2,800,000 this year with 40% net profit and approximately 8,000,000 in two years. Let's go. Main constraint, season seasonality. So we do about 65% of our annual revenue in six months. And if I don't solve this, I either say no to demand in summer, or I am supply constrained in sorry. Or I am overstuffed in winter.
[1] Speaker 0: Yeah. So, one thing right off the bat I will say is that this is a feature, not a bug of the industry that you're in. Right? Same thing as lawn care guys, same thing as guys who do snow plowing. It's just a it's a super common thing. Swimming pools sometimes, obviously, in the summer. So, like, there there are industries that are just going to be more smoothies if you have summer versus Italian ice store. Like, there's a lot, right, that are seasonal. Now couple questions. So catering, what is your what is your hot season again?
[2] Speaker 1: Busy season.
[3] Speaker 0: Yeah. What is the busy season?
[4] Speaker 1: Pretty much, September through February.
[5] Speaker 0: Okay. And so from now until September is when it's slow? Yes. So what why are people not celebrating from now until September? Actually, I'm not even sure of why. Season. I I think yeah. It's it's not it's not as much of a festive season. I think people don't spend as much money, going through winter.
[6] Speaker 1: I don't know if any of that has to do with
[7] Speaker 0: just East of, like in general. East don't worry about economy. They whatever. I'll just remove economy from from Lexington. There's nothing you can do about it. So okay. So people don't do Easter. You don't do corporate events?
[8] Speaker 1: We do do corporate. Yes. So we tie our corporate through winter more so. They have spent a lifetime value, but they have lower spend per per event, which lowers gross profit. So we do market more or less exclusively to to private.
[9] Speaker 0: Okay. I'm just like it actually doesn't sound like you're actually in that seasonal of a business. People have, like I mean, I started with that, but, like, catering happens year round. I mean, shoot, I cater every single week.
[10] Speaker 1: Yeah. So we we we do large events. So, typically, kinda 60 to a 100 people. Mhmm. The, like, birthday parties, engagements, weddings, there all year round, but a lot of the corporate rush that comes through in summer, the end of year staff parties, things of that nature, that's what it takes us, like, well beyond our capacity, which gives us that busy season. And then through winter, we just we lose a lot of that.
[11] Speaker 0: You subsist in the not in the off season. Correct? You, like, lose money or break even in the off season?
[12] Speaker 1: No. No. We're still profitable. We have a really good we have strong gross profit and strong margins, so we're still good. Okay. We like to make more money. Yeah. Okay. Got it.
[13] Speaker 0: Okay. So a couple things. So currently, how are you getting customers?
[14] Speaker 1: We have really strong organic SEO, and we also do a lot of Google Ads.
[15] Speaker 0: Okay.
[16] Speaker 1: That's the most that they're the main channels. So we have probably 50% organic, 4040% organic, 40% ads, 20% referral.
[17] Speaker 0: Okay. Top of funnel on MetUp, but it's less tracked.
[18] Speaker 1: It's more more of a brand awareness. Got it. So SEO and PPC kinda kinda rule rule the day.
[19] Speaker 0: Okay. So what stops you from spending more PPC? Are you maxed out? Like, is it stopping profitable? Like, what's what's stopping you there?
[20] Speaker 1: Search volume and, like, quarterly drops through winter. So Okay. Back to LTV is still strong at a 12 to one, so we can just spend more. So I'm trying to find I guess, my constraint or my my question my main question becomes I have considered popping up a corporate delivery, like a prepackaged, like, typical corporate catering setting through Yachtet to be a kind of entity under catered by Matt, which would be a year round service because they have a very inverted seasonality to the event side where the corporate to order in more of that delivery, but it's it's I don't wanna get distracted. Like, I'm watch one of your content. I don't wanna change the woman in a red dress because it's a whole new business.
[21] Speaker 0: Yeah. Well, I guess the, like, the problem that we're trying to solve here, like, you are profitable. You're running 40% even in the fact that there's on and off cycle. So to grow the business, we could ignore the fact that it's lumpy. I'll give you two examples of this. So Harry and David's, it's a chocolate company here in The US, does, like, 100% of their annual profit in the month of December. And then the other eleven months of the year, they have their mall location, and they just lose money. Right. That's number one. Others, if you look at, insurance, right, insurance makes money every year, and then every eighth year, there's a hurricane Katrina, and they lose a bunch of money. And so I think what we what we need to replace is the difference between volatility and risk. So you can have something that is volatile but not risky. So insurance is volatile but not risky. Same as this chocolate thing. It's volatile in the fact that it changes a lot month to month to month, but it's not risky because it's predictable. You know that every season this is going to happen. And if we know it's going to happen, then we can predict it. If we can predict it, we can plan for it. Right? So all that to say, if we change nothing about the business, but you simply did twice as much, what stops you from doing that?
[22] Speaker 1: Nothing.
[23] Speaker 0: Okay. Nothing. Everything everything is quite efficient, to be to be frank. We can we can just spend more, hire more. Well, then then I think you have have that answer. I think what what feels annoying is you just wish that I you know, if you're Harry and David's, you wish that the other eleven months of the year, people celebrated chocolate as much. Right? But you're just gonna have a slow season and a hot season, and that's fine, especially especially since you're not losing money in the off season. So I don't think you actually have a big problem to solve here. Think we just need to do more of what's working. I wish I could pull some magic, business model out of a hat, but if you're profitable all the months of the year and then some months you just make more money, that just sounds like a business that has a predictable cycle.
[24] Speaker 1: Right.
[25] Speaker 0: Yeah. Mean, think about the alternative. It could be unpredictable. That would suck.
[26] Speaker 1: Yeah. No. It's it's it's it's it's almost predictable to the to the percent, to be honest. It's pretty pretty consistent. I've I've been trying to contemplate, like, how to get around this without actually starting a new business, and I'll just I've been thinking about it for a couple of years. I thought may maybe Alex would figure something out, but I I maybe it is just that, hey. It's just a feature. No. What I would like to do is just focus all of your time on not trying to solve that problem and solving the more important problem, which is like how do we double PPC and probably get meta ads going?
[27] Speaker 0: Like, you did nothing else this year, double p c PPC and just cracked meta ads, you'd hit your goal.
[28] Speaker 1: Yep. So it's like if you can double the business doing one thing, why do four? Yeah. Touche.
[29] Speaker 0: Right? Yeah. That's it, man. I mean, the whole point of of theory of constraints is focus, and it's just being able to say all the things you say no to. Like, there's such limited resources in a small business, the biggest one being your time, your effort, and your mental bandwidth. If you can just say, like, I'm not looking at this anymore because this is just a feature of my business, and I'm so grateful because all my competitors will be distracted by the shiny object. Like, let them worry about that while you just keep crushing it. And them. Okay. Cool? Yeah. Cool. Thank you. Appreciate you, man. Congratulations.
[30] Speaker 1: Thank you. Alright. Thanks, brother. Talk soon. Bye bye.
[31] Speaker 0: Toodaloo.

DECISIONS:

[0] TRIM: My name is Matthew. I sell premium catering experiences to proper clients looking to celebrate milestone events in Sydney. We grew about 2,800,000 this year with 40% net profit and approximately 8,000,000 in two years. Let's go. Main constraint, season seasonality. So we do about 65% of our annual revenue in six months. And if I don't solve this, I either say no to demand in summer, or I am supply constrained Or I am overstuffed in winter.
[1] TRIM: Yeah. So, one thing right off the bat I will say is that this is a feature, not a bug of the industry that you're in. Same thing as lawn care guys, same thing as guys who do snow plowing.
[2] REMOVE
[3] REMOVE
[4] REMOVE
[5] REMOVE
[6] REMOVE
[7] REMOVE
[8] REMOVE
[9] REMOVE
[10] REMOVE
[11] REMOVE
[12] TRIM: We're still profitable. We have a really good we have strong gross profit and strong margins, so we're still good.
[13] REMOVE
[14] REMOVE
[15] REMOVE
[16] REMOVE
[17] REMOVE
[18] REMOVE
[19] REMOVE
[20] REMOVE
[21] TRIM: the, like, the problem that we're trying to solve here, like, you are profitable. You're running 40% even in the fact that there's on and off cycle. So to grow the business, we could ignore the fact that it's lumpy. I'll give you two examples of this. So Harry and David's, it's a chocolate company here in The US, does, like, 100% of their annual profit in the month of December. And then the other eleven months of the year, they have their mall location, and they just lose money. And so I think what we what we need to replace is the difference between volatility and risk. So you can have something that is volatile but not risky. It's volatile in the fact that it changes a lot month to month to month, but it's not risky because it's predictable. You know that every season this is going to happen. And if we know it's going to happen, then we can predict it. If we can predict it, we can plan for it. Right? So all that to say, if we change nothing about the business, but you simply did twice as much, what stops you from doing that?
[22] KEEP
[23] TRIM: But you're just gonna have a slow season and a hot season, and that's fine, especially especially since you're not losing money in the off season. So I don't think you actually have a big problem to solve here. Think we just need to do more of what's working. I wish I could pull some magic, business model out of a hat, but if you're profitable all the months of the year and then some months you just make more money,
[24] REMOVE
[25] REMOVE
[26] TRIM: What I would like to do is just focus all of your time on not trying to solve that problem and solving the more important problem, which is like how do we double PPC and probably get meta ads going?
[27] KEEP
[28] TRIM: Yep. So it's like if you can double the business doing one thing, why do four?
[29] TRIM: That's it, man. I mean, the whole point of of theory of constraints is focus, and it's just being able to say all the things you say no to. Like, there's such limited resources in a small business, the biggest one being your time, your effort, and your mental bandwidth. If you can just say, like, I'm not looking at this anymore because this is just a feature of my business, and I'm so grateful because all my competitors will be distracted by the shiny object. Like, let them worry about that while you just keep crushing it.
[30] REMOVE
[31] REMOVE
</example>

</examples>

Now output ONLY decision lines for the following transcript:`;
