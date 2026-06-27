BEGIN;

-- Park the Level 1 exit exam out of the way so module seqs 2-10 are free.
UPDATE modules SET module_sequence_number = 900 WHERE level_number = 1 AND evaluation_kind = 'exit_exam';

-- ===== Level 1 · Module 1: God & His Nature =====
INSERT INTO modules (level_number, module_sequence_number, title, lesson_content, evaluation_kind, estimated_minutes, quiz_pass_mark, status)
VALUES (1, 1, $NT$God & His Nature$NT$, $NB$Lesson 1: Knowing God the Father, the Son, the Holy Spirit—and Me (John 1:1–18)

1) Who Is God?
God is not a product of creation. He is the One who created creation. The Bible

opens by saying, “In the beginning God created the heavens and the earth”

(Genesis 1:1). That means everything that exists depends on Him, but He depends on

nothing.

God did not “start” the way we start. When God introduced Himself to Moses, He

said, “I AM WHO I AM” (Exodus 3:14). In simple terms: God has no origin story. He

simply is.

And God is not distant. He is present everywhere. He says nothing is hidden from Him

and He fills all things (Jeremiah 23:23–24; Ephesians 4:6).
2) The Nature of God (What God is

like)
God’s nature helps you trust Him. Here are the key things Scripture shows us:

God is loving, relational and absolutely faithful. Everything He does is out of love. His

justice is not cold. He is steady, consistent, and keeps His word. “Love and faithfulness

go before you” (Psalm 89:14). And He does not change. “I the LORD do not change”

(Malachi 3:6).

God is eternal. He has no beginning and no end. “From everlasting to everlasting

you are God” (Psalm 90:2). That means God does not age, weaken, or run out.

God is righteous. He is morally perfect. He never does wrong, and He sets the

standard for what is right. “Righteousness… is the foundation of your throne” (Psalm

89:14).

God is just. He is perfectly fair. He does not ignore evil or pretend sin is small.

“Righteousness and justice are the foundation of your throne” (Psalm 89:14). So when

God judges, He is never biased or mistaken.
3) The Trinity (Father, Son, Holy

Spirit)
The Bible teaches one true God, who exists eternally as three distinct Persons: Father,

Son, and Holy Spirit. Jesus commanded baptism “in the name of the Father and of

the Son and of the Holy Spirit” (Matthew 28:19). One name—three Persons.

This matters because God didn’t save us by accident. Father, Son, and Spirit work

together in one saving plan (2 Corinthians 13:14).

4) Why couldn’t God just forgive

sin?
Because God is not only loving—He is also just. If a judge ignores evil, that judge

becomes unjust. In the same way, God cannot pretend sin is fine. Sin must be

judged truthfully because justice is part of who God is (Psalm 89:14).

This is why salvation is not God “overlooking” sin, but God dealing with sin through

Jesus.

5) Who is Jesus Christ?
John 1 answers this clearly: Jesus is not merely a prophet or teacher. He is the eternal

Word. “In the beginning was the Word… and the Word was God” (John 1:1). He is

also Creator: “Through him all things were made” (John 1:3). Then comes the shock

of the gospel: “The Word became flesh” (John 1:14). God stepped into our human

world to rescue us.

Jesus asked, “Who do you say I am?” (Matthew 16:15). And Scripture shows that

knowing Jesus truly is not just intelligence—it is revelation from God (Matthew 16:17).

6) Who is the Holy Spirit?
The Holy Spirit is not a force. He is God, and He is personal. In Acts 5, Peter says lying

to the Holy Spirit is lying to God (Acts 5:3–4). Jesus also calls Him the Spirit of truth who

guides believers (John 16:13).

The Holy Spirit lives in believers, leads them into truth, and points them to Jesus (John

14:17; John 15:26; John 16:13–14).

7) Who am I?
When you receive Christ, you are not just “trying to be better.” You become part of

God’s family. “To all who did receive him… he gave the right to become children of

God” (John 1:12–13).

You are saved by mercy and made new by the Spirit (Titus 3:5–7). You are not left to

fight alone; you are led by the Spirit as God’s child (Romans 8:14).
Simple class takeaway

  ●​ God is the eternal Creator (Genesis 1:1; Exodus 3:14).

  ●​ God is righteous, just, loving, and faithful (Psalm 89:14; Malachi 3:6).

  ●​ God is one—Father, Son, Spirit (Matthew 28:19).

  ●​ Sin must be judged, so salvation required Jesus (Psalm 89:14; John 1:14).

  ●​ In Christ, you become a child of God (John 1:12–13).$NB$, 'quiz', 8, 70, 'published')
ON CONFLICT (level_number, module_sequence_number) DO UPDATE SET
  title = EXCLUDED.title, lesson_content = EXCLUDED.lesson_content, evaluation_kind = EXCLUDED.evaluation_kind,
  estimated_minutes = EXCLUDED.estimated_minutes, quiz_pass_mark = EXCLUDED.quiz_pass_mark,
  status = 'published', updated_at = now();
DELETE FROM question_bank WHERE module_id = (SELECT module_id FROM modules WHERE level_number=1 AND module_sequence_number=1);
INSERT INTO question_bank (module_id, q_type, question_text, answer_options, correct_answer, difficulty_rating, is_active)
SELECT module_id, 'multiple_choice', $NQ$The module begins by explaining where God came from. It says God is not a product of creation but is the One who created creation. According to the text, what is true about God's relationship to everything that exists?$NQ$, $NA${"choices":[{"id":"opt-l1m1q1o1","text":"Everything depends on Him, but He depends on nothing","is_correct":true},{"id":"opt-l1m1q1o2","text":"He depends on creation to sustain His existence","is_correct":false},{"id":"opt-l1m1q1o3","text":"He and creation came into being together","is_correct":false},{"id":"opt-l1m1q1o4","text":"He created the world and then withdrew from it","is_correct":false}]}$NA$::jsonb, $NC$Everything depends on Him, but He depends on nothing$NC$, 1, TRUE
  FROM modules WHERE level_number=1 AND module_sequence_number=1;
INSERT INTO question_bank (module_id, q_type, question_text, answer_options, correct_answer, difficulty_rating, is_active)
SELECT module_id, 'multiple_choice', $NQ$The text teaches that the Bible reveals one true God who exists eternally as three distinct Persons. Which three Persons does it name as the Trinity?$NQ$, $NA${"choices":[{"id":"opt-l1m1q2o1","text":"The Father, the Son, and the Holy Spirit","is_correct":true},{"id":"opt-l1m1q2o2","text":"The Father, the Son, and the angels","is_correct":false},{"id":"opt-l1m1q2o3","text":"The Creator, the Word, and the prophets","is_correct":false},{"id":"opt-l1m1q2o4","text":"The Father, the Spirit, and the Church","is_correct":false}]}$NA$::jsonb, $NC$The Father, the Son, and the Holy Spirit$NC$, 1, TRUE
  FROM modules WHERE level_number=1 AND module_sequence_number=1;
INSERT INTO question_bank (module_id, q_type, question_text, answer_options, correct_answer, difficulty_rating, is_active)
SELECT module_id, 'multiple_choice', $NQ$The module describes God as eternal, saying He has no beginning and no end. Based on this part of the text, what does being eternal mean about God?$NQ$, $NA${"choices":[{"id":"opt-l1m1q3o1","text":"He does not age, weaken, or run out","is_correct":true},{"id":"opt-l1m1q3o2","text":"He grows stronger over time","is_correct":false},{"id":"opt-l1m1q3o3","text":"He had a beginning but will have no end","is_correct":false},{"id":"opt-l1m1q3o4","text":"He exists only outside of time and cannot act in it","is_correct":false}]}$NA$::jsonb, $NC$He does not age, weaken, or run out$NC$, 2, TRUE
  FROM modules WHERE level_number=1 AND module_sequence_number=1;
INSERT INTO question_bank (module_id, q_type, question_text, answer_options, correct_answer, difficulty_rating, is_active)
SELECT module_id, 'multiple_choice', $NQ$When discussing who Jesus is, John 1 is used to make a clear point. The text says Jesus is not merely a prophet or teacher. How does the module describe Jesus?$NQ$, $NA${"choices":[{"id":"opt-l1m1q4o1","text":"He is the eternal Word, who was God and through whom all things were made","is_correct":true},{"id":"opt-l1m1q4o2","text":"He is the greatest of the prophets sent to teach","is_correct":false},{"id":"opt-l1m1q4o3","text":"He is a force that guides believers into truth","is_correct":false},{"id":"opt-l1m1q4o4","text":"He is a created being who later became divine","is_correct":false}]}$NA$::jsonb, $NC$He is the eternal Word, who was God and through whom all things were made$NC$, 2, TRUE
  FROM modules WHERE level_number=1 AND module_sequence_number=1;
INSERT INTO question_bank (module_id, q_type, question_text, answer_options, correct_answer, difficulty_rating, is_active)
SELECT module_id, 'multiple_choice', $NQ$The module corrects a common misunderstanding about the Holy Spirit. It states that in Acts 5 Peter says lying to the Holy Spirit is lying to God. What does the text conclude about the Holy Spirit?$NQ$, $NA${"choices":[{"id":"opt-l1m1q5o1","text":"He is not a force; He is God, and He is personal","is_correct":true},{"id":"opt-l1m1q5o2","text":"He is an impersonal power that God sends out","is_correct":false},{"id":"opt-l1m1q5o3","text":"He is a created helper who serves God","is_correct":false},{"id":"opt-l1m1q5o4","text":"He is only the influence of God on the heart","is_correct":false}]}$NA$::jsonb, $NC$He is not a force; He is God, and He is personal$NC$, 3, TRUE
  FROM modules WHERE level_number=1 AND module_sequence_number=1;
INSERT INTO question_bank (module_id, q_type, question_text, answer_options, correct_answer, difficulty_rating, is_active)
SELECT module_id, 'multiple_choice', $NQ$The text says when you receive Christ you are not just 'trying to be better.' Drawing on John 1:12-13, what does the module say happens to a person who receives Him?$NQ$, $NA${"choices":[{"id":"opt-l1m1q6o1","text":"They are given the right to become children of God","is_correct":true},{"id":"opt-l1m1q6o2","text":"They earn God's approval through better behavior","is_correct":false},{"id":"opt-l1m1q6o3","text":"They are made into a force that guides others","is_correct":false},{"id":"opt-l1m1q6o4","text":"They become prophets and teachers for God","is_correct":false}]}$NA$::jsonb, $NC$They are given the right to become children of God$NC$, 3, TRUE
  FROM modules WHERE level_number=1 AND module_sequence_number=1;
INSERT INTO question_bank (module_id, q_type, question_text, answer_options, correct_answer, difficulty_rating, is_active)
SELECT module_id, 'multiple_choice', $NQ$The module describes God's nature with several qualities meant to help you trust Him. It stresses that His justice is not cold and that He keeps His word and does not change. Which combination of qualities does the text use to describe God's nature?$NQ$, $NA${"choices":[{"id":"opt-l1m1q7o1","text":"Loving, relational, absolutely faithful, and unchanging","is_correct":true},{"id":"opt-l1m1q7o2","text":"Loving but distant and sometimes changing","is_correct":false},{"id":"opt-l1m1q7o3","text":"Faithful only to those who first obey Him","is_correct":false},{"id":"opt-l1m1q7o4","text":"Just but unconcerned with love or relationship","is_correct":false}]}$NA$::jsonb, $NC$Loving, relational, absolutely faithful, and unchanging$NC$, 4, TRUE
  FROM modules WHERE level_number=1 AND module_sequence_number=1;
INSERT INTO question_bank (module_id, q_type, question_text, answer_options, correct_answer, difficulty_rating, is_active)
SELECT module_id, 'multiple_choice', $NQ$The module asks why God couldn't just forgive sin. It compares God to a judge and explains the consequence of ignoring evil. According to the text, why is simply overlooking sin not an option for God?$NQ$, $NA${"choices":[{"id":"opt-l1m1q8o1","text":"Because He is also just, and ignoring evil would make Him unjust","is_correct":true},{"id":"opt-l1m1q8o2","text":"Because He is too distant to notice sin","is_correct":false},{"id":"opt-l1m1q8o3","text":"Because forgiveness is not part of His nature","is_correct":false},{"id":"opt-l1m1q8o4","text":"Because sin is too small for Him to care about","is_correct":false}]}$NA$::jsonb, $NC$Because He is also just, and ignoring evil would make Him unjust$NC$, 4, TRUE
  FROM modules WHERE level_number=1 AND module_sequence_number=1;
INSERT INTO question_bank (module_id, q_type, question_text, answer_options, correct_answer, difficulty_rating, is_active)
SELECT module_id, 'multiple_choice', $NQ$The text connects God's justice to the work of salvation, explaining that sin must be judged truthfully because justice is part of who God is. Based on this reasoning, how does the module describe what salvation actually is?$NQ$, $NA${"choices":[{"id":"opt-l1m1q9o1","text":"God dealing with sin through Jesus, not God overlooking sin","is_correct":true},{"id":"opt-l1m1q9o2","text":"God deciding to ignore sin out of love","is_correct":false},{"id":"opt-l1m1q9o3","text":"God lowering His standard so sin no longer matters","is_correct":false},{"id":"opt-l1m1q9o4","text":"God leaving people to fight sin on their own","is_correct":false}]}$NA$::jsonb, $NC$God dealing with sin through Jesus, not God overlooking sin$NC$, 5, TRUE
  FROM modules WHERE level_number=1 AND module_sequence_number=1;
INSERT INTO question_bank (module_id, q_type, question_text, answer_options, correct_answer, difficulty_rating, is_active)
SELECT module_id, 'multiple_choice', $NQ$The module teaches that the Trinity matters because God did not save us by accident. Pulling together what the text says about the Father, Son, and Spirit, why does it say the Trinity is important for salvation?$NQ$, $NA${"choices":[{"id":"opt-l1m1q10o1","text":"Father, Son, and Spirit work together in one saving plan","is_correct":true},{"id":"opt-l1m1q10o2","text":"Each Person offers a separate and competing path to God","is_correct":false},{"id":"opt-l1m1q10o3","text":"Only the Son is involved in saving people","is_correct":false},{"id":"opt-l1m1q10o4","text":"The three Persons take turns acting at different times","is_correct":false}]}$NA$::jsonb, $NC$Father, Son, and Spirit work together in one saving plan$NC$, 5, TRUE
  FROM modules WHERE level_number=1 AND module_sequence_number=1;

-- ===== Level 1 · Module 2: God's Plan for Humanity =====
INSERT INTO modules (level_number, module_sequence_number, title, lesson_content, evaluation_kind, estimated_minutes, quiz_pass_mark, status)
VALUES (1, 2, $NT$God's Plan for Humanity$NT$, $NB$HUMANITY

(Creation → Fall → Rescue)

The Original Plan

The original plan of God was to make a man that would share the

intricate beauty of God’s glory as a friend. God desired to extend His

glorious heavenly presence to earth—having a man to reflect Him,

fellowship with Him, and also administrate over His creation.
      Catch this: God did not create man for distance—He created

      man for divine friendship and kingdom function.

​

In simple words: Man was designed to carry God’s presence and

represent God’s authority on the earth.

2 Corinthians 5:20 (KJV)​

“Now then we are ambassadors for Christ, as though God did beseech

you by us: we pray you in Christ’s stead, be ye reconciled to God.”

The Image of God

Genesis 1:26 (KJV)​

“And God said, Let us make man in our image, after our likeness: and

let them have dominion over the fish of the sea, and over the fowl of

the air, and over the cattle, and over all the earth, and over every

creeping thing that creepeth upon the earth.”

The Image of God inbuilt in man as highlighted in the above scripture

underscores the embodiment of the likeness of God in man. In other

words, man was created with the full capacity to reflect God. This

entails His holiness, His mind, and His way of dealings.
       Catch this: Image is identity; likeness is capacity; dominion is

       assignment.

​

So man was not merely made to exist—man was made to mirror God

and manage what God made.

For example, in 1 Peter 1:15, the Bible pictures the possibility of mirroring

the holiness of God in the recreated human spirit.

1 Peter 1:15–16 (KJV)​

“But as he which hath called you is holy, so be ye holy in all manner of

conversation;​

Because it is written, Be ye holy; for I am holy.”

What is sin?

Sin is the degenerated state of a man from the image of the Father. This

degenerated, corrupted state produces the fruits of sin—these are the

inward and outward corrupt dealings inconsistent with the nature of

God.
It is this state that causes a created being to desire independence from

God, standing in rebellion against His will and ways.

       Catch this: Sin is not only what you do—sin is what you became

       when you disconnected from the Source.

​

Sin is nature before it becomes behavior, and identity corruption before

it becomes actions.

The first created being to embody sin was Lucifer, when he showed

extreme pride and rebellion, desiring to exalt himself above God and

usurp His authority, leading to his expulsion from heaven.

    Isaiah 14:12–15 (KJV)

“How art thou fallen from heaven, O Lucifer, son of the morning! how

art thou cut down to the ground, which didst weaken the nations!​

For thou hast said in thine heart, I will ascend into heaven, I will exalt my

throne above the stars of God: I will sit also upon the mount of the

congregation, in the sides of the north:

​

I will ascend above the heights of the clouds; I will be like the most High.​

Yet thou shalt be brought down to hell, to the sides of the pit.”

The Fall of Man
Man was given a choice: to choose to follow God’s word of not eating

the fruit or to eat. In the beginning, that was not hard until Satan,

through his choice of self-will, chose to disobey God, and took

advantage of the self-choice of man and tricked Adam into sinning.

The man attracted the penalty of God’s righteous judgement and the

consequence resulted into a fallen nature of man.

Catch this: A wrong choice did not only produce a wrong action—it

produced a wrong nature.​

His nature was deformed by sin and he became laden with a

degenerated DNA of sin.

    Romans 5:12–14 (KJV)

“Wherefore, as by one man sin entered into the world, and death by

sin; and so death passed upon all men, for that all have sinned:​

(For until the law sin was in the world: but sin is not imputed when there

is no law.

​

Nevertheless death reigned from Adam to Moses, even over them that

had not sinned after the similitude of Adam’s transgression, who is the

figure of him that was to come.)”

Have you noticed how children are inclined to tell lies or do

mischievous things yet no one has taught them these things? This points
to the inherent nature of sin passed to all men following the rebellion of

the first man, Adam.

Catch this: Nobody teaches a child to be selfish—selfishness is the

evidence of the inherited fall.​

That is why this problem is deeper than morals: it is spiritual DNA.

Why Jesus Came

Jesus came to cure the nature of sin in man by replacing the

degenerated DNA of sin in man by generating a new state of

righteousness in God through Christ. Christ reintroduced the choice: if a

man chooses to turn himself to Christ and be healed, allowing Jesus

Christ to regenerate his nature, he gets restored to the original plan of

God—which is to receive the gift of God’s nature (righteousness) and

host His glory.

      Catch this: Jesus did not come to manage sin—He came to

      remove it at the root.

​

He did not come to improve the old man—He came to replace the old

nature with a new nature.
John 3:17 (KJV)​

“For God sent not his Son into the world to condemn the world; but that

the world through him might be saved.”

The Restoration Plan

The restoration plan was made very simple: just as a man made a

self-choice to look away from God towards Satan’s coaction of sinning,

he can also choose to look away from Satan and look up on Christ and

receive the gift of God.

     Catch this: The door that choice opened in Eden, choice can

     close at the Cross.

​

You are not forced into restoration—you are invited into it.

Romans 10:9–10 (KJV)​

“That if thou shalt confess with thy mouth the Lord Jesus, and shalt

believe in thine heart that God hath raised him from the dead, thou

shalt be saved.
​

For with the heart man believeth unto righteousness; and with the

mouth confession is made unto salvation.”

(Regenerated to full life from the deformed nature of sin.)

    The Great Exchange (Part 1)

“The moment your debt became His, and His righteousness became

yours.”

2 Corinthians 5:21 (KJV)​

“For he hath made him to be sin for us, who knew no sin; that we might

be made the righteousness of God in him.”

Salvation is not just a powerful moment—it is a permanent change of

position. Many people feel the excitement of being saved, then life

returns to normal and doubt whispers, “Did anything really change?”

Yes. Something changed—not only your feelings, but your spiritual state

before God. Salvation is not a feeling to maintain; it is a fact to believe

and a reality to live from.

The core idea is simple: you did not turn over a new leaf—you received

a new life. Christianity is not self-help. It is resurrection. Not a bad person

trying harder, but a dead person being made alive by the Holy Spirit. If

you treat faith like a renovation project, you will keep getting
disappointed by yourself. But if you understand it as a total

replacement, you will stand on grace, not performance.

The Great Exchange is what happened at the cross. Jesus did not

ignore sin—He paid for it. A divine trade took place: your sin and debt

were placed on Him, and His righteousness was placed on you. Your

old history was closed, and a new history began. That is why you can

stand before a holy God with confidence—because your standing is

based on Christ’s finished work, not your daily consistency.

     Catch this:

        ●​ Not guilt-managed—debt-cancelled.

        ●​ Not covered-up—legally exchanged.

        ●​ Not improved—reborn.

        ●​ Not a second chance—an entirely new creation.

Key Scriptural Anchors (and what

they mean)
  1) New Creation — 2 Corinthians 5:17

You are not a repaired version of your old self. You are new. The old

record, the old nature, the old spiritual DNA—replaced. God did not

patch you up; He recreated you in Christ.
2 Corinthians 5:17 (KJV)​

“Therefore if any man be in Christ, he is a new creature: old things are

passed away; behold, all things are become new.”

   2) Legal Trade — 2 Corinthians 5:21

This is the exchange: Jesus took your judgment, and you received His

righteousness. He was treated as if He lived your life, so you can be

treated as if you lived His. This is not a spiritual cover-up—it is a legal

reality.

   3) Adoption — John 1:12

You did not join a religious club. You became a child of God. A

member can be removed, but a son has a place by birth. You now

have authority to call God Father.

John 1:12 (KJV)​

“But as many as received him, to them gave he power to become the

sons of God, even to them that believe on his name:”

What Changed

Keep these as clear pillars—not feelings, not guesses, not vibes—pillars:
   1.​ Regeneration (Heart Change): The Holy Spirit gave you new life.

      New desires, new hunger for truth, new conviction—this is not just

      behavior change, it is nature change.

   2.​ Justification (Status Change): God does not only forgive you; He

      declares you righteous because Jesus satisfied justice. Your

      standing is secure.

   3.​ Reconciliation (Relationship Change): The war ended. The wall

      fell. You were brought back to God—peace is not a trick; it is a

      restored relationship.

Catch this: Regeneration changes your inside. Justification changes

your standing. Reconciliation changes your access.

Reflection & Action

Reflect: When you don’t feel new, why does God still call you new?

Because feelings often follow last, but truth stands first.

Action: Write three past burdens you still carry. Next to each one write:

PAID IN FULL (2 Corinthians 5:21). If Jesus carried it, you are not

supposed to keep carrying it.$NB$, 'quiz', 11, 70, 'published')
ON CONFLICT (level_number, module_sequence_number) DO UPDATE SET
  title = EXCLUDED.title, lesson_content = EXCLUDED.lesson_content, evaluation_kind = EXCLUDED.evaluation_kind,
  estimated_minutes = EXCLUDED.estimated_minutes, quiz_pass_mark = EXCLUDED.quiz_pass_mark,
  status = 'published', updated_at = now();
DELETE FROM question_bank WHERE module_id = (SELECT module_id FROM modules WHERE level_number=1 AND module_sequence_number=2);
INSERT INTO question_bank (module_id, q_type, question_text, answer_options, correct_answer, difficulty_rating, is_active)
SELECT module_id, 'multiple_choice', $NQ$Module 2 opens by describing God's original plan for humanity. According to the teaching, why did God make man?$NQ$, $NA${"choices":[{"id":"opt-l1m2q1o1","text":"To share the intricate beauty of God's glory as a friend","is_correct":true},{"id":"opt-l1m2q1o2","text":"To populate the earth and multiply across the nations","is_correct":false},{"id":"opt-l1m2q1o3","text":"To labor over the ground and tend the animals alone","is_correct":false},{"id":"opt-l1m2q1o4","text":"To live at a distance from God and worship from afar","is_correct":false}]}$NA$::jsonb, $NC$To share the intricate beauty of God's glory as a friend$NC$, 1, TRUE
  FROM modules WHERE level_number=1 AND module_sequence_number=2;
INSERT INTO question_bank (module_id, q_type, question_text, answer_options, correct_answer, difficulty_rating, is_active)
SELECT module_id, 'multiple_choice', $NQ$The module states that man was designed for a particular role on the earth. In simple words, what was man designed to do?$NQ$, $NA${"choices":[{"id":"opt-l1m2q2o1","text":"To carry God's presence and represent God's authority on the earth","is_correct":true},{"id":"opt-l1m2q2o2","text":"To build cities and establish kingdoms in God's name","is_correct":false},{"id":"opt-l1m2q2o3","text":"To record God's words and pass them to future generations","is_correct":false},{"id":"opt-l1m2q2o4","text":"To remain hidden from creation until God called him forth","is_correct":false}]}$NA$::jsonb, $NC$To carry God's presence and represent God's authority on the earth$NC$, 1, TRUE
  FROM modules WHERE level_number=1 AND module_sequence_number=2;
INSERT INTO question_bank (module_id, q_type, question_text, answer_options, correct_answer, difficulty_rating, is_active)
SELECT module_id, 'multiple_choice', $NQ$The module gives a memorable 'Catch this' line about the Image of God in man, breaking it into three parts. According to that line, what do image, likeness, and dominion each represent?$NQ$, $NA${"choices":[{"id":"opt-l1m2q3o1","text":"Image is identity; likeness is capacity; dominion is assignment","is_correct":true},{"id":"opt-l1m2q3o2","text":"Image is glory; likeness is holiness; dominion is fellowship","is_correct":false},{"id":"opt-l1m2q3o3","text":"Image is identity; likeness is authority; dominion is friendship","is_correct":false},{"id":"opt-l1m2q3o4","text":"Image is capacity; likeness is identity; dominion is reflection","is_correct":false}]}$NA$::jsonb, $NC$Image is identity; likeness is capacity; dominion is assignment$NC$, 2, TRUE
  FROM modules WHERE level_number=1 AND module_sequence_number=2;
INSERT INTO question_bank (module_id, q_type, question_text, answer_options, correct_answer, difficulty_rating, is_active)
SELECT module_id, 'multiple_choice', $NQ$The module defines sin in terms of a person's state, not merely their actions. How does the teaching define what sin is?$NQ$, $NA${"choices":[{"id":"opt-l1m2q4o1","text":"The degenerated state of a man from the image of the Father","is_correct":true},{"id":"opt-l1m2q4o2","text":"A list of wrong actions that break God's written law","is_correct":false},{"id":"opt-l1m2q4o3","text":"The temporary mistakes a believer makes before repentance","is_correct":false},{"id":"opt-l1m2q4o4","text":"A weakness of the body that fades as a person matures","is_correct":false}]}$NA$::jsonb, $NC$The degenerated state of a man from the image of the Father$NC$, 2, TRUE
  FROM modules WHERE level_number=1 AND module_sequence_number=2;
INSERT INTO question_bank (module_id, q_type, question_text, answer_options, correct_answer, difficulty_rating, is_active)
SELECT module_id, 'multiple_choice', $NQ$The module names the first created being to embody sin and explains what he did. Who was it, and what did he do?$NQ$, $NA${"choices":[{"id":"opt-l1m2q5o1","text":"Lucifer, who showed extreme pride and rebellion, desiring to exalt himself above God","is_correct":true},{"id":"opt-l1m2q5o2","text":"Adam, who ate the fruit and attracted God's righteous judgement","is_correct":false},{"id":"opt-l1m2q5o3","text":"Satan, who tricked Eve before he had ever sinned himself","is_correct":false},{"id":"opt-l1m2q5o4","text":"Cain, who rebelled against God's will out of jealousy and anger","is_correct":false}]}$NA$::jsonb, $NC$Lucifer, who showed extreme pride and rebellion, desiring to exalt himself above God$NC$, 3, TRUE
  FROM modules WHERE level_number=1 AND module_sequence_number=2;
INSERT INTO question_bank (module_id, q_type, question_text, answer_options, correct_answer, difficulty_rating, is_active)
SELECT module_id, 'multiple_choice', $NQ$Describing the Fall, the module explains how Adam came to sin. According to the teaching, what happened?$NQ$, $NA${"choices":[{"id":"opt-l1m2q6o1","text":"Satan, through his own self-will, took advantage of the self-choice of man and tricked Adam into sinning","is_correct":true},{"id":"opt-l1m2q6o2","text":"Adam invented sin on his own without any outside influence at all","is_correct":false},{"id":"opt-l1m2q6o3","text":"God withdrew His presence, leaving Adam no choice but to disobey","is_correct":false},{"id":"opt-l1m2q6o4","text":"Adam was forced by Lucifer to eat the fruit against his own will","is_correct":false}]}$NA$::jsonb, $NC$Satan, through his own self-will, took advantage of the self-choice of man and tricked Adam into sinning$NC$, 3, TRUE
  FROM modules WHERE level_number=1 AND module_sequence_number=2;
INSERT INTO question_bank (module_id, q_type, question_text, answer_options, correct_answer, difficulty_rating, is_active)
SELECT module_id, 'multiple_choice', $NQ$The module uses the example of children to make a point about sin. It observes that children are inclined to lie or do mischievous things though no one taught them. What does this point to?$NQ$, $NA${"choices":[{"id":"opt-l1m2q7o1","text":"The inherent nature of sin passed to all men following the rebellion of the first man, Adam","is_correct":true},{"id":"opt-l1m2q7o2","text":"The failure of parents to model good moral behavior early","is_correct":false},{"id":"opt-l1m2q7o3","text":"A passing stage of immaturity that disappears with discipline","is_correct":false},{"id":"opt-l1m2q7o4","text":"The influence of a sinful society shaping a child's choices","is_correct":false}]}$NA$::jsonb, $NC$The inherent nature of sin passed to all men following the rebellion of the first man, Adam$NC$, 4, TRUE
  FROM modules WHERE level_number=1 AND module_sequence_number=2;
INSERT INTO question_bank (module_id, q_type, question_text, answer_options, correct_answer, difficulty_rating, is_active)
SELECT module_id, 'multiple_choice', $NQ$The module explains why Jesus came, contrasting it with merely managing sin. According to the teaching, what did Jesus come to do about the nature of sin?$NQ$, $NA${"choices":[{"id":"opt-l1m2q8o1","text":"To cure the nature of sin by replacing the degenerated DNA of sin and generating a new state of righteousness","is_correct":true},{"id":"opt-l1m2q8o2","text":"To help the old man try harder and gradually improve his behavior","is_correct":false},{"id":"opt-l1m2q8o3","text":"To cover up sin so that God would no longer see man's failures","is_correct":false},{"id":"opt-l1m2q8o4","text":"To manage sin's effects until man could overcome it on his own","is_correct":false}]}$NA$::jsonb, $NC$To cure the nature of sin by replacing the degenerated DNA of sin and generating a new state of righteousness$NC$, 4, TRUE
  FROM modules WHERE level_number=1 AND module_sequence_number=2;
INSERT INTO question_bank (module_id, q_type, question_text, answer_options, correct_answer, difficulty_rating, is_active)
SELECT module_id, 'multiple_choice', $NQ$In 'The Great Exchange,' the module insists salvation is more than a powerful, emotional moment. How does the teaching describe what salvation actually is?$NQ$, $NA${"choices":[{"id":"opt-l1m2q9o1","text":"A permanent change of position and a fact to believe, not a feeling to maintain","is_correct":true},{"id":"opt-l1m2q9o2","text":"A renovation project where a bad person learns to try harder","is_correct":false},{"id":"opt-l1m2q9o3","text":"A second chance to prove yourself worthy through daily consistency","is_correct":false},{"id":"opt-l1m2q9o4","text":"A feeling of excitement that you must work hard to keep alive","is_correct":false}]}$NA$::jsonb, $NC$A permanent change of position and a fact to believe, not a feeling to maintain$NC$, 5, TRUE
  FROM modules WHERE level_number=1 AND module_sequence_number=2;
INSERT INTO question_bank (module_id, q_type, question_text, answer_options, correct_answer, difficulty_rating, is_active)
SELECT module_id, 'multiple_choice', $NQ$Under 'What Changed,' the module lists three pillars and a 'Catch this' line tying each to a specific change. According to that line, what does each pillar change?$NQ$, $NA${"choices":[{"id":"opt-l1m2q10o1","text":"Regeneration changes your inside; justification changes your standing; reconciliation changes your access","is_correct":true},{"id":"opt-l1m2q10o2","text":"Regeneration changes your access; justification changes your inside; reconciliation changes your standing","is_correct":false},{"id":"opt-l1m2q10o3","text":"Regeneration changes your standing; justification changes your access; reconciliation changes your inside","is_correct":false},{"id":"opt-l1m2q10o4","text":"Regeneration changes your feelings; justification changes your behavior; reconciliation changes your status","is_correct":false}]}$NA$::jsonb, $NC$Regeneration changes your inside; justification changes your standing; reconciliation changes your access$NC$, 5, TRUE
  FROM modules WHERE level_number=1 AND module_sequence_number=2;

-- ===== Level 1 · Module 3: Salvation by Grace =====
INSERT INTO modules (level_number, module_sequence_number, title, lesson_content, evaluation_kind, estimated_minutes, quiz_pass_mark, status)
VALUES (1, 3, $NT$Salvation by Grace$NT$, $NB$1) Understanding Salvation

Salvation is the helpless and dying receiving help to live again.

In the Bible, salvation is the gracious and undeserved gift of deliverance from the

penalty, the power, and the future presence of sin, resulting in eternal life. It is

achieved solely through faith in Jesus Christ’s sacrificial death and resurrection—not

by human works. It reconciles man back to God.

Jonah 2:9 (KJV)​

“But I will sacrifice unto thee with the voice of thanksgiving; I will pay that that I have

vowed. Salvation is of the Lord.”

Catch this: Salvation is not man climbing toward God by effort—salvation is God

rescuing man by grace.

A drowning man does not first need advice. He needs rescue. In the same way, the

sinner does not first need inspiration, religion, or moral polishing. He needs salvation.

Acts 4:12 (KJV)​

“Neither is there salvation in any other: for there is none other name under heaven

given among men, whereby we must be saved.”

In simple words:

   ●​ Salvation is God’s rescue plan for a fallen man.

   ●​ Salvation is found only in Jesus Christ.
    ●​ Salvation is not earned by works.

2) Salvation by Grace

Salvation by grace is when you receive the gift of life that you could not buy /

afford.

Grace means God gives what man could never earn. It is the mercy and kindness of

God extended toward the undeserving. Grace is not a reward for effort. Grace is

not wages for good conduct. Grace is the gift of God to the man who could never

pay for life, righteousness, or acceptance.

Ephesians 2:8–9 (KJV)​

“For by grace are ye saved through faith; and that not of yourselves: it is the gift of

God:​

Not of works, lest any man should boast.”

Catch this: What you could never afford, grace placed into your hands as a gift.

Grace does not mean sin was small. Grace means the problem of sin was so deep

and so costly that only the death and resurrection of Jesus Christ could deal with it

fully.

If salvation could be earned, Christ would not have needed to die. But because

man could not save himself, grace made a way.

Titus 3:5 (KJV)​

“Not by works of righteousness which we have done, but according to his mercy he

saved us, by the washing of regeneration, and renewing of the Holy Ghost;”

In simple words:
   ●​ Salvation is a gift, not a salary.

   ●​ Grace means God gave what man could not earn.

   ●​ No man can boast before God concerning salvation.

3) Repentance and Faith

Repentance is being sorry of one’s sin and turning away from the sin to not do them.

Biblically, repentance is more than emotion. It is more than regret. It is a change of

mind, heart, and direction toward God. Repentance happens when a man stops

excusing sin, agrees with God about it, and turns away from it toward Christ.

Faith is the hand that receives what grace has provided. Repentance turns away

from sin. Faith turns toward Jesus Christ.

Mark 1:15 (KJV)​

“And saying, The time is fulfilled, and the kingdom of God is at hand: repent ye, and

believe the gospel.”

Catch this: Repentance is not only tears—it is a turn. Faith is not only agreement—it is

a receiving.

A man may feel bad and still remain unchanged. But when repentance is real, there

is a turning. When faith is real, there is a receiving of Christ and a resting in His finished

work.

Acts 20:21 (KJV)​

“Testifying both to the Jews, and also to the Greeks, repentance toward God, and

faith toward our Lord Jesus Christ.”

In simple words:

   ●​ Repentance means turning away from sin.

   ●​ Faith means turning toward Jesus Christ.
   ●​ True repentance and faith lead to conversion.

4) The New Birth

Salvation is not only forgiveness. It is new birth.

A man who comes to Christ is not merely excused and then left the same. He is born

again. God does not only cancel a debt; He gives new life. He does not only

remove guilt; He regenerates the inner man.

John 3:3 (KJV)​

“Jesus answered and said unto him, Verily, verily, I say unto thee, Except a man be

born again, he cannot see the kingdom of God.”

Catch this: God does not only forgive the sinner—He regenerates the man.

Christianity is not a bad man trying harder. It is a dead man being made alive by

God. It is not simply a second chance. It is the beginning of a new life-source.

1 Peter 1:23 (KJV)​

“Being born again, not of corruptible seed, but of incorruptible, by the word of God,

which liveth and abideth for ever.”

In simple words:

   ●​ Salvation gives more than forgiveness.

   ●​ Salvation gives new life.

   ●​ New birth is the inward miracle of salvation.

5) The Great Exchange and Righteousness by Grace
At the cross, a divine exchange

took place.
Jesus did not merely sympathize with man’s pain. He stood in man’s place. He took

sin, guilt, judgment, and condemnation upon Himself so that the believer could

receive righteousness, acceptance, peace, and access to God.

2 Corinthians 5:21 (KJV)​

“For he hath made him to be sin for us, who knew no sin; that we might be made the

righteousness of God in him.”

Catch this: Your debt became His, and His righteousness became yours.

Righteousness by grace is when your righteousness does not depend on your works

but by His finished “work” on the cross.

This means a believer stands accepted before God, not because he has performed

well enough, but because Jesus Christ finished the work. Our standing before God is

based on Christ’s obedience, sacrifice, and victory.

Romans 5:1 (KJV)​

“Therefore being justified by faith, we have peace with God through our Lord Jesus

Christ:”

Philippians 3:9 (KJV)​

“And be found in him, not having mine own righteousness, which is of the law, but

that which is through the faith of Christ, the righteousness which is of God by faith:”

In simple words:

   ●​ Jesus took our sin and judgment.
    ●​ We received righteousness and peace through Him.

    ●​ Our standing with God rests on Christ, not on self-effort.

6) Eternal Life

Eternal life is the life of God which has no end becoming our life.

Eternal life is not only endless existence. It is the very life of God shared with the

believer through Christ. It begins now and continues forever. So when a man is

saved, he does not only receive a better future—he receives a new life now.

John 5:24 (KJV)​

“Verily, verily, I say unto you, He that heareth my word, and believeth on him that

sent me, hath everlasting life, and shall not come into condemnation; but is passed

from death unto life.”

Catch this: Eternal life is not only a future promise—it is a present possession in Christ.

A believer is not merely waiting to live later. He has already passed from death unto

life.

1 John 5:11–12 (KJV)​

“And this is the record, that God hath given to us eternal life, and this life is in his Son.​

He that hath the Son hath life; and he that hath not the Son of God hath not life.”

In simple words:

    ●​ Eternal life is in the Son.

    ●​ If you have Christ, you have life.

    ●​ Eternal life begins now and continues forever.
7) Commitment

Commitment is your resolve empowered by God to live the life of God every day as

it is called NOW.

Commitment is not the price a man pays to be saved. Commitment is the fruit of a

life that has truly encountered salvation. Grace saves freely, but grace never

produces careless living. Grace teaches, shapes, and leads a man into daily

obedience.

Luke 9:23 (KJV)​

“And he said to them all, If any man will come after me, let him deny himself, and

take up his cross daily, and follow me.”

Catch this: Commitment is not how you buy salvation—commitment is how salvation

begins to show itself.

A truly saved man begins to walk with God. He begins to obey. He begins to hunger

for truth. He begins to live differently—not to earn salvation, but because the life of

God is now at work in him.

Titus 2:11–12 (KJV)​

“For the grace of God that bringeth salvation hath appeared to all men,​

Teaching us that, denying ungodliness and worldly lusts, we should live soberly,

righteously, and godly, in this present world;”

In simple words:

   ●​ Commitment is the fruit of salvation.

   ●​ Grace teaches the believer how to live.

   ●​ A saved man begins to follow God daily.
8) The First Walk of the Saved Man

The man who enters Christ must not remain unattended.

Salvation is the door, but discipleship is the road. A man who has been saved must

be taught, grounded, guided, and established in the faith. The New Testament

pattern is not just a decision, but a continued life in doctrine, fellowship, prayer, and

obedience.

Matthew 28:19–20 (KJV)​

“Go ye therefore, and teach all nations, baptizing them in the name of the Father,

and of the Son, and of the Holy Ghost:​

Teaching them to observe all things whatsoever I have commanded you: and, lo, I

am with you alway, even unto the end of the world. Amen.”

Catch this: Salvation is the beginning of the journey, not the end of the story.

This is why the believer must not stay isolated. He must grow in the Word, in prayer, in

fellowship, and in faithful Christian living.

Acts 2:41–42 (KJV)​

“Then they that gladly received his word were baptized: and the same day there

were added unto them about three thousand souls.​

And they continued stedfastly in the apostles’ doctrine and fellowship, and in

breaking of bread, and in prayers.”

In simple words:

   ●​ Salvation is the door.

   ●​ Discipleship is the road.

   ●​ A believer must continue in truth, fellowship, and obedience.
9) What Changed

Keep these as clear pillars:

   1.​ Rescue — You were delivered from sin and judgment.

   2.​ Grace — You received what you could not buy / afford.

   3.​ Repentance — You turned from sin toward God.

   4.​ Faith — You received Christ and His finished work.

   5.​ New Birth — You received new life from above.

   6.​ Righteousness — You now stand right before God in Christ.

   7.​ Eternal Life — The life of God became your life.

   8.​ Commitment — Grace now teaches you to walk with God.

   9.​ Discipleship — You must continue in truth, fellowship, and obedience.

Catch this: Not improved—reborn. Not tolerated—accepted in Christ. Not

self-made—grace-made. Not left alone—called to follow.

Reflection & Action

Reflect:​

Have you treated salvation as a moment only, or have you understood it as rescue,

grace, new birth, right standing, and a new walk?

Action:​

Write these lines and pray through them:

   ●​ I am saved by grace through faith in Jesus Christ.

   ●​ I turn away from sin and turn toward God.

   ●​ I have been born again by the Spirit of God.

   ●​ My righteousness is in Christ, not in myself.
  ●​ Eternal life is now at work in me.

  ●​ By the help of the Holy Spirit, I will walk with God daily.

Simple Class Takeaway

  ●​ Salvation is the helpless and dying receiving help to live again.

  ●​ Salvation by grace is when you receive the gift of life that you could not buy /

     afford.

  ●​ Repentance and faith are man’s true response to the gospel.

  ●​ The new birth is the inward miracle of salvation.

  ●​ Righteousness by grace means our standing with God rests on Christ’s finished

     work.

  ●​ Eternal life is the life of God becoming our life.

  ●​ Commitment is the daily, God-empowered walk that flows from true

     salvation.

  ●​ Discipleship is the road every truly saved man must walk.$NB$, 'quiz', 13, 70, 'published')
ON CONFLICT (level_number, module_sequence_number) DO UPDATE SET
  title = EXCLUDED.title, lesson_content = EXCLUDED.lesson_content, evaluation_kind = EXCLUDED.evaluation_kind,
  estimated_minutes = EXCLUDED.estimated_minutes, quiz_pass_mark = EXCLUDED.quiz_pass_mark,
  status = 'published', updated_at = now();
DELETE FROM question_bank WHERE module_id = (SELECT module_id FROM modules WHERE level_number=1 AND module_sequence_number=3);
INSERT INTO question_bank (module_id, q_type, question_text, answer_options, correct_answer, difficulty_rating, is_active)
SELECT module_id, 'multiple_choice', $NQ$Module 3 opens by defining salvation in a simple way. According to the text, salvation is best described as which of the following?$NQ$, $NA${"choices":[{"id":"opt-l1m3q1o1","text":"The helpless and dying receiving help to live again","is_correct":true},{"id":"opt-l1m3q1o2","text":"A reward given to those who try their hardest to obey God","is_correct":false},{"id":"opt-l1m3q1o3","text":"A moral improvement that good people gradually achieve","is_correct":false},{"id":"opt-l1m3q1o4","text":"An inspiring message that motivates people to do better","is_correct":false}]}$NA$::jsonb, $NC$The helpless and dying receiving help to live again$NC$, 1, TRUE
  FROM modules WHERE level_number=1 AND module_sequence_number=3;
INSERT INTO question_bank (module_id, q_type, question_text, answer_options, correct_answer, difficulty_rating, is_active)
SELECT module_id, 'multiple_choice', $NQ$The lesson defines salvation by grace using a picture of a gift. How does the text describe salvation by grace?$NQ$, $NA${"choices":[{"id":"opt-l1m3q2o1","text":"Receiving the gift of life that you could not buy or afford","is_correct":true},{"id":"opt-l1m3q2o2","text":"Earning life by paying God back over time","is_correct":false},{"id":"opt-l1m3q2o3","text":"A loan of life that must be repaid through good works","is_correct":false},{"id":"opt-l1m3q2o4","text":"A wage given to man for his good conduct","is_correct":false}]}$NA$::jsonb, $NC$Receiving the gift of life that you could not buy or afford$NC$, 1, TRUE
  FROM modules WHERE level_number=1 AND module_sequence_number=3;
INSERT INTO question_bank (module_id, q_type, question_text, answer_options, correct_answer, difficulty_rating, is_active)
SELECT module_id, 'multiple_choice', $NQ$The text uses the image of a drowning man to make a point about the sinner's deepest need. What does it say the sinner first needs?$NQ$, $NA${"choices":[{"id":"opt-l1m3q3o1","text":"Salvation, rather than inspiration, religion, or moral polishing","is_correct":true},{"id":"opt-l1m3q3o2","text":"Better advice on how to fix his own life","is_correct":false},{"id":"opt-l1m3q3o3","text":"A religion that gives him rules to follow","is_correct":false},{"id":"opt-l1m3q3o4","text":"Moral polishing to slowly become acceptable","is_correct":false}]}$NA$::jsonb, $NC$Salvation, rather than inspiration, religion, or moral polishing$NC$, 2, TRUE
  FROM modules WHERE level_number=1 AND module_sequence_number=3;
INSERT INTO question_bank (module_id, q_type, question_text, answer_options, correct_answer, difficulty_rating, is_active)
SELECT module_id, 'multiple_choice', $NQ$In the section on Repentance and Faith, the text distinguishes the two by direction. How does it describe them?$NQ$, $NA${"choices":[{"id":"opt-l1m3q4o1","text":"Repentance turns away from sin, and faith turns toward Jesus Christ","is_correct":true},{"id":"opt-l1m3q4o2","text":"Repentance turns toward Christ, and faith turns away from sin","is_correct":false},{"id":"opt-l1m3q4o3","text":"Repentance and faith both mean simply feeling sorry for sin","is_correct":false},{"id":"opt-l1m3q4o4","text":"Repentance is receiving Christ, and faith is changing one's mind","is_correct":false}]}$NA$::jsonb, $NC$Repentance turns away from sin, and faith turns toward Jesus Christ$NC$, 2, TRUE
  FROM modules WHERE level_number=1 AND module_sequence_number=3;
INSERT INTO question_bank (module_id, q_type, question_text, answer_options, correct_answer, difficulty_rating, is_active)
SELECT module_id, 'multiple_choice', $NQ$The section on the New Birth contrasts forgiveness with something more. According to the text, what does God do beyond cancelling a debt and removing guilt?$NQ$, $NA${"choices":[{"id":"opt-l1m3q5o1","text":"He gives new life and regenerates the inner man","is_correct":true},{"id":"opt-l1m3q5o2","text":"He leaves the man the same but excused","is_correct":false},{"id":"opt-l1m3q5o3","text":"He gives the man a second chance to try harder","is_correct":false},{"id":"opt-l1m3q5o4","text":"He removes only the penalty but not the guilt","is_correct":false}]}$NA$::jsonb, $NC$He gives new life and regenerates the inner man$NC$, 3, TRUE
  FROM modules WHERE level_number=1 AND module_sequence_number=3;
INSERT INTO question_bank (module_id, q_type, question_text, answer_options, correct_answer, difficulty_rating, is_active)
SELECT module_id, 'multiple_choice', $NQ$The text describes 'the Great Exchange' that took place at the cross. What does it say was exchanged?$NQ$, $NA${"choices":[{"id":"opt-l1m3q6o1","text":"Your debt became His, and His righteousness became yours","is_correct":true},{"id":"opt-l1m3q6o2","text":"Your good works became the basis of your acceptance","is_correct":false},{"id":"opt-l1m3q6o3","text":"Jesus sympathized with man's pain without taking his place","is_correct":false},{"id":"opt-l1m3q6o4","text":"Man's effort was exchanged for God's approval","is_correct":false}]}$NA$::jsonb, $NC$Your debt became His, and His righteousness became yours$NC$, 3, TRUE
  FROM modules WHERE level_number=1 AND module_sequence_number=3;
INSERT INTO question_bank (module_id, q_type, question_text, answer_options, correct_answer, difficulty_rating, is_active)
SELECT module_id, 'multiple_choice', $NQ$The lesson defines eternal life in a way that goes beyond mere length of existence. How does the text describe eternal life?$NQ$, $NA${"choices":[{"id":"opt-l1m3q7o1","text":"The very life of God shared with the believer, beginning now and continuing forever","is_correct":true},{"id":"opt-l1m3q7o2","text":"Only an endless existence that begins after a person dies","is_correct":false},{"id":"opt-l1m3q7o3","text":"Merely a better future that the believer is still waiting to receive","is_correct":false},{"id":"opt-l1m3q7o4","text":"A reward earned by faithful living over a lifetime","is_correct":false}]}$NA$::jsonb, $NC$The very life of God shared with the believer, beginning now and continuing forever$NC$, 4, TRUE
  FROM modules WHERE level_number=1 AND module_sequence_number=3;
INSERT INTO question_bank (module_id, q_type, question_text, answer_options, correct_answer, difficulty_rating, is_active)
SELECT module_id, 'multiple_choice', $NQ$The text is careful about how commitment relates to salvation. According to the lesson, what is commitment?$NQ$, $NA${"choices":[{"id":"opt-l1m3q8o1","text":"The fruit of a life that has truly encountered salvation","is_correct":true},{"id":"opt-l1m3q8o2","text":"The price a man pays in order to be saved","is_correct":false},{"id":"opt-l1m3q8o3","text":"Careless living that grace permits after salvation","is_correct":false},{"id":"opt-l1m3q8o4","text":"The works that earn a man his right standing with God","is_correct":false}]}$NA$::jsonb, $NC$The fruit of a life that has truly encountered salvation$NC$, 4, TRUE
  FROM modules WHERE level_number=1 AND module_sequence_number=3;
INSERT INTO question_bank (module_id, q_type, question_text, answer_options, correct_answer, difficulty_rating, is_active)
SELECT module_id, 'multiple_choice', $NQ$In 'The First Walk of the Saved Man,' the text uses a door-and-road image to explain salvation and discipleship. Which statement matches the text?$NQ$, $NA${"choices":[{"id":"opt-l1m3q9o1","text":"Salvation is the door, but discipleship is the road","is_correct":true},{"id":"opt-l1m3q9o2","text":"Discipleship is the door, but salvation is the road","is_correct":false},{"id":"opt-l1m3q9o3","text":"Salvation is both the door and the end of the journey","is_correct":false},{"id":"opt-l1m3q9o4","text":"A single decision is all the New Testament pattern requires","is_correct":false}]}$NA$::jsonb, $NC$Salvation is the door, but discipleship is the road$NC$, 5, TRUE
  FROM modules WHERE level_number=1 AND module_sequence_number=3;
INSERT INTO question_bank (module_id, q_type, question_text, answer_options, correct_answer, difficulty_rating, is_active)
SELECT module_id, 'multiple_choice', $NQ$The 'What Changed' summary ends with a set of contrasts capturing the whole lesson. Which set of contrasts does the text give?$NQ$, $NA${"choices":[{"id":"opt-l1m3q10o1","text":"Not improved but reborn; not tolerated but accepted in Christ; not self-made but grace-made; not left alone but called to follow","is_correct":true},{"id":"opt-l1m3q10o2","text":"Not forgiven but ignored; not rescued but advised; not reborn but improved; not led but left alone","is_correct":false},{"id":"opt-l1m3q10o3","text":"Not saved by grace but earned by works; not accepted but tolerated; not reborn but excused","is_correct":false},{"id":"opt-l1m3q10o4","text":"Not a gift but a salary; not a turning but mere tears; not new life but a second chance","is_correct":false}]}$NA$::jsonb, $NC$Not improved but reborn; not tolerated but accepted in Christ; not self-made but grace-made; not left alone but called to follow$NC$, 5, TRUE
  FROM modules WHERE level_number=1 AND module_sequence_number=3;

-- ===== Level 1 · Module 4: Identity in Christ =====
INSERT INTO modules (level_number, module_sequence_number, title, lesson_content, evaluation_kind, estimated_minutes, quiz_pass_mark, status)
VALUES (1, 4, $NT$Identity in Christ$NT$, $NB$New Creation Foundations

Lesson Objective
By the end of this lesson, the disciple should be able to:

   ●​ understand what happened to him when he came to Christ,

   ●​ explain what it means to be a new creation,

   ●​ know the difference between spirit, soul, and body,

   ●​ walk free from condemnation,

   ●​ stand in Christ-given authority,

   ●​ and begin to live daily from his new identity in Christ.

Introduction: From Salvation to Identity

Module 1 revealed who God is: righteous, just, loving, faithful, and eternal. Module 2

showed God’s plan for humanity, the fall of man, and the need for rescue. Module 3

explained salvation by grace: how Christ saves, gives new birth, grants righteousness,

and brings eternal life. Now Module 4 answers the next question: Who am I now that I

am in Christ?

Many believers know they are forgiven, but they still think of themselves using the

language of the old life. They still speak from guilt, fear, weakness, and past failure.

But Scripture does not present salvation as a mere clean-up of the old man.

Scripture presents salvation as entry into a new life, a new standing, a new family,

and a new creation in Christ. John 1:12–13 says those who receive Christ are given

the right to become children of God, and 2 Corinthians 5:17 says that if any man is in

Christ, he is a new creature.

Now you know: Salvation did not only change your destination. It changed your

identity.

Quick Truths
   ●​ You are not who you were before Christ.

   ●​ You are not defined by your old history.

   ●​ You are not trying to become accepted.

   ●​ In Christ, you have been brought into a new life.

Who Am I in Christ?

What does Scripture say about my identity in Christ?

I am a child of God

John 1:12–13 teaches that those who receive and believe in Jesus Christ are given

the right to become children of God. This sonship is not produced by natural birth,

human effort, or religious activity. It is received through faith in Christ.

I was chosen and set apart in Christ

Scripture speaks of believers as chosen, sanctified, and called according to God’s

purpose. Ephesians 1:4–5 shows that God chose us in Christ and predestined us unto

adoption, while passages such as Romans 8:29–30 and 2 Thessalonians 2:13 show

God’s saving initiative and sanctifying work. This does not make the believer proud; it

makes him grateful.

I am part of a royal priesthood

1 Peter 2:9 describes believers as a chosen generation, a royal priesthood, a holy

nation, and a people belonging to God. This means your life now carries divine

purpose. You are no longer merely part of the crowd. You have been called out of

darkness into God’s marvelous light.

I am of heaven here on earth
The believer still lives on earth, but his source, identity, and citizenship are now rooted

in Christ. He is no longer defined by the old order of sin and separation. He belongs

to God and must now live from above while walking on the earth.

Now you know: Identity in Christ is not built from your feelings, your past, your tribe,

your wounds, or your failures. It is received from God.

The New Creation in Christ

In Christ, you become new

2 Corinthians 5:17 says:​

“Therefore if any man be in Christ, he is a new creature: old things are passed away;

behold, all things are become new.”

Many Christians think being born again means only that sins are forgiven. That is true,

but it is not the whole matter. Salvation includes forgiveness, but it also includes a

real inward change. The believer is brought into a new creation reality in Christ. The

old order of sin no longer has the final word over him. Romans 6 teaches that the old

man was crucified with Christ, and now the believer must no longer think of himself

as still chained to the former life.

This is why a Christian must stop speaking as though the old self is still his deepest

truth. When someone says, “I am just short-tempered,” “I have always been like this,”

or “That is simply who I am,” he is often speaking from an identity Christ has already

judged at the Cross.

Your new nature is fashioned after Christ. That does not mean your maturity is

complete in one day. It means your identity has changed before your growth is

complete.
Now you know: You are not an old man trying to improve. In Christ, you are new,

and now you must learn to live from that newness.

Quick Truths

   ●​ The old life is no longer your master.

   ●​ Your past is not your deepest identity.

   ●​ The believer’s new life is rooted in union with Christ.

   ●​ Growth is progressive, but identity is settled in Christ.

What It Means to Be in Christ

To be in Christ is to be joined to Him. It means that what Christ accomplished

becomes the ground of your standing before God. You are accepted in Him, made

alive in Him, justified in Him, and brought near in Him.

What it means to be in Christ:

   ●​ Not condemned, but set free. Romans 8:1–2 declares that there is now no

       condemnation to those who are in Christ Jesus.

   ●​ Possessor of eternal life. The believer does not merely wait for life later; he has

       life in the Son now.

   ●​ Of heaven here on earth. The believer’s deepest source is no longer the fallen

       order. He now belongs to God.

   ●​ Brought into God’s family. He is not just forgiven from a distance; he is

       received as a son.

Now you know: Christianity is not merely following Christ from outside. It is being

joined to Him.
Man Is Spirit, Soul, and Body

1 Thessalonians 5:23 shows that man has three dimensions:

   ●​ Spirit

   ●​ Soul

   ●​ Body

       What these mean:

   ●​ The body is the outward man.

   ●​ The soul is the mind, will, and emotions.

   ●​ The spirit is the inner man.

This is important because many believers become confused about salvation when

they do not understand where the new birth happens first. They expect instant visible

change in every area, and when they do not see it, they begin to question whether

anything happened at all.

But the new birth is spiritual before it becomes visible in conduct.

Now you know: Salvation is instant in the spirit, then worked out progressively in the

soul, and finally completed fully even in the body.

The Change Happens in the Spirit

Salvation does not first change your body. It does not first perfect your soul. The part

made alive and made new is the spirit. That is why outward appearance alone

cannot tell you whether someone is born again. There is no automatic change in

skin, height, weight, or physical structure. The new birth is a spiritual work of God.
It is also true that salvation does not instantaneously complete the renewal of the

soul. The mind, emotions, and will must be sanctified and trained by the Word of

God. John 17:17 says, “Sanctify them through thy truth: thy word is truth,” and

Romans 12:2 calls believers to be transformed by the renewing of their minds. Acts 20

also speaks of the Word of God’s grace as able to build believers up.

So when a believer still struggles in thought patterns, emotional wounds, or learned

habits, that does not prove the new birth is false. It proves that sanctification is now

needed. Being born again is instantaneous. Renewal and purification in daily living

are progressive.

Therefore:

   ●​ Your spirit was made new at salvation.

   ●​ Your soul now needs renewal by the Word.

   ●​ Your daily life must catch up with what God already did in your spirit.

Now you know: The recreated spirit begins the new life. The renewed mind learns

how to live it.

Before Salvation, Man Was Spiritually Dead

Ephesians 2:1 says: “And you hath he quickened, who were dead in trespasses and

sins.”

Spiritual death means separation from the life of God. It is not the end of existence; it

is the condition of being cut off from God. Fallen man may be active outwardly, but

inwardly he is dead toward God.
This matches what Modules 2 and 3 already established. Sin was not merely wrong

behavior. It was a fallen condition. Therefore, man did not just need advice,

instruction, or discipline. He needed life.

Now you know: A dead man does not first need motivation. He needs life.

Salvation Makes the Spirit Alive Again

When a person comes to Christ, the spirit is made alive and becomes new. Galatians

4:6 says that because we are sons, God has sent forth the Spirit of His Son into our

hearts, crying, “Abba, Father.” John 1:12 again shows that believers are brought into

sonship through faith in Christ.

The Christian life is then the lifelong learning of how to live outwardly from what God

has already done inwardly.

Now you know:

When you are in Christ, your spirit becomes new.​

The rest of your growth is learning to live from that new identity.

In Christ, You Have a Restored Place of Authority

As new creations in Christ, our place of authority over darkness is restored. This

means the devil no longer has lawful dominion over the believer. Christ has delivered

us from the power of darkness and translated us into the kingdom of His dear Son.

Ephesians 2:6 says we have been raised up together and made to sit together in

heavenly places in Christ Jesus. Ephesians 1:20–23 shows Christ far above principality,
power, might, and dominion. Colossians 1:13–14 declares deliverance from the

power of darkness.

Mark 16:17–18 shows signs that follow those who believe in the name of Jesus. This

includes authority over demons and the exercise of Christ’s power in ministry. But this

authority is not self-generated. It is exercised in Christ’s name, under Christ’s lordship,

and by faith in what He accomplished.

Therefore:

   ●​ The believer is no longer under Satan’s rule.

   ●​ The believer stands in the name of Jesus.

   ●​ The believer must be conscious of his place in Christ.

   ●​ Authority must be exercised in line with the will of God.

Now you know: You do not fight for Christ’s victory as though He has not won. You

stand in His victory and enforce what He achieved.

In Christ, You Are Free from Condemnation

Romans 8:1–2 says:​

“There is therefore now no condemnation to them which are in Christ Jesus… For the

law of the Spirit of life in Christ Jesus hath made me free from the law of sin and

death.”

This means the believer is free from God’s judicial condemnation. He has moved

from guilt to justification, from separation to peace, and from death to life in Christ.
One of the enemy’s sharpest weapons against Christians is guilt. He keeps replaying

old failures to keep the believer weak, ashamed, and distant from God. A Christian

may still carry guilt over sins that God already forgave when they were confessed.

1 John 1:9 teaches that if we confess our sins, God is faithful and just to forgive us

and to cleanse us from all unrighteousness. 2 Corinthians 5:18–19 shows the ministry

of reconciliation: God reconciling us to Himself in Christ.

Learn this difference:

   ●​ The devil guilts.

   ●​ The Holy Spirit convicts.

Guilt pushes you away from God. Conviction draws you back to God. Guilt isolates.

Conviction restores fellowship.

Now you know: God does not correct you so He can throw you away. He deals with

you so He can restore you.

What Happens When a Christian Sins?

When a Christian sins, that sin does not become his identity, but it does contradict his

new identity. Sin does not erase sonship, but it disrupts fellowship, grieves the Spirit,

damages witness, and opens room for unnecessary bondage and consequences.

The believer must never use “identity in Christ” as an excuse for careless living.

Your original note said, “The sin disfigures the image of God in us.” The safer and

clearer way to teach it is this: sin contradicts the life and nature now at work in the

believer. If it is tolerated, it produces destructive fruit. If it is confessed, God forgives

and cleanses. The Spirit of God guides us away from sin and into obedience.
Therefore:

   ●​ Sin is serious.

   ●​ The believer must not excuse it.

   ●​ Confession restores fellowship.

   ●​ The Holy Spirit leads the believer away from sin.

   ●​ Identity in Christ must produce holy living, not careless living.

Now you know: Sin may interrupt fellowship, but it is not the truth of your new identity.

Return quickly to God and walk again in the light.

Foundation of a New Believer

These are the foundational truths a new believer must know:

   ●​ Changed from death in sin and made alive in Jesus Christ​

       You were dead, but now alive in Him.

   ●​ The old is gone, the new has come​

       Your former identity is no longer your deepest truth.

   ●​ We walk by the Spirit of God​

       The Christian life is lived by the Spirit, not by bare human effort.

   ●​ He is a child of God​

       This must be settled in the heart of every believer.

Integrated Identity Summary
So then, who are you in Christ?

   ●​ You are a child of God.

   ●​ You are a new creation.

   ●​ You are no longer spiritually dead.

   ●​ You have been made alive in Christ.

   ●​ You are not condemned.

   ●​ You have been brought near to God.

   ●​ You have access to the Father.

   ●​ You have authority in the name of Jesus.

   ●​ You have eternal life now.

   ●​ You are being renewed by the Word.

   ●​ You are called to walk in the Spirit.

   ●​ You are part of a royal priesthood and a holy nation.

Now you know: Your growth may still be progressing, but your identity in Christ is

already established.

Reflection and Action

Reflect

   ●​ Have you been speaking about yourself using old labels that Christ has

       already judged?

   ●​ Have you reduced salvation to forgiveness only and ignored new creation?

   ●​ Have you mistaken slow growth in the soul for absence of life in the spirit?

   ●​ Have you allowed condemnation to speak louder than Scripture?

Action

Write these lines and pray through them:
 ●​ I am in Christ; therefore I am a new creation.

 ●​ I am a child of God through Jesus Christ.

 ●​ I have been made alive from spiritual death.

 ●​ I am not under condemnation in Christ.

 ●​ I have been delivered from the authority of darkness.

 ●​ My mind is being renewed by the Word of God.

 ●​ I will live from my new identity and not from my old history.

 ●​ When I fail, I will return to God quickly and walk again in truth.

Simple Class Takeaway

 ●​ Identity in Christ answers the question: Who am I now that I am saved?

 ●​ The believer is a new creation in Christ.

 ●​ The new birth happens first in the spirit.

 ●​ The soul must be renewed by the Word of God.

 ●​ The believer has been made alive, brought into sonship, and set in a new

    standing before God.

 ●​ In Christ, the believer has a restored place of authority.

 ●​ In Christ, the believer is free from condemnation.

 ●​ When a Christian sins, he must not hide; he must return to God in confession

    and continue walking in the light.

 ●​ Christian growth is learning to live outwardly from what God already did

    inwardly.$NB$, 'quiz', 17, 70, 'published')
ON CONFLICT (level_number, module_sequence_number) DO UPDATE SET
  title = EXCLUDED.title, lesson_content = EXCLUDED.lesson_content, evaluation_kind = EXCLUDED.evaluation_kind,
  estimated_minutes = EXCLUDED.estimated_minutes, quiz_pass_mark = EXCLUDED.quiz_pass_mark,
  status = 'published', updated_at = now();
DELETE FROM question_bank WHERE module_id = (SELECT module_id FROM modules WHERE level_number=1 AND module_sequence_number=4);
INSERT INTO question_bank (module_id, q_type, question_text, answer_options, correct_answer, difficulty_rating, is_active)
SELECT module_id, 'multiple_choice', $NQ$Module 4 builds on the earlier modules. According to the introduction, the central question that Module 4 sets out to answer is:$NQ$, $NA${"choices":[{"id":"opt-l1m4q1o1","text":"Who am I now that I am in Christ?","is_correct":true},{"id":"opt-l1m4q1o2","text":"Who is God and what is His character?","is_correct":false},{"id":"opt-l1m4q1o3","text":"How does Christ save and grant righteousness?","is_correct":false},{"id":"opt-l1m4q1o4","text":"What is God's plan for humanity and the fall of man?","is_correct":false}]}$NA$::jsonb, $NC$Who am I now that I am in Christ?$NC$, 1, TRUE
  FROM modules WHERE level_number=1 AND module_sequence_number=4;
INSERT INTO question_bank (module_id, q_type, question_text, answer_options, correct_answer, difficulty_rating, is_active)
SELECT module_id, 'multiple_choice', $NQ$The lesson quotes 2 Corinthians 5:17. According to that verse as given in the text, if any man is in Christ:$NQ$, $NA${"choices":[{"id":"opt-l1m4q2o1","text":"he is a new creature; old things are passed away and all things are become new","is_correct":true},{"id":"opt-l1m4q2o2","text":"he is forgiven of his sins only and nothing else changes","is_correct":false},{"id":"opt-l1m4q2o3","text":"he must work to become accepted by God","is_correct":false},{"id":"opt-l1m4q2o4","text":"he remains an old man who is simply trying to improve","is_correct":false}]}$NA$::jsonb, $NC$he is a new creature; old things are passed away and all things are become new$NC$, 1, TRUE
  FROM modules WHERE level_number=1 AND module_sequence_number=4;
INSERT INTO question_bank (module_id, q_type, question_text, answer_options, correct_answer, difficulty_rating, is_active)
SELECT module_id, 'multiple_choice', $NQ$The lesson teaches that man has three dimensions based on 1 Thessalonians 5:23. According to the text, the soul is:$NQ$, $NA${"choices":[{"id":"opt-l1m4q3o1","text":"the mind, will, and emotions","is_correct":true},{"id":"opt-l1m4q3o2","text":"the inner man","is_correct":false},{"id":"opt-l1m4q3o3","text":"the outward man","is_correct":false},{"id":"opt-l1m4q3o4","text":"the part made alive first at salvation","is_correct":false}]}$NA$::jsonb, $NC$the mind, will, and emotions$NC$, 2, TRUE
  FROM modules WHERE level_number=1 AND module_sequence_number=4;
INSERT INTO question_bank (module_id, q_type, question_text, answer_options, correct_answer, difficulty_rating, is_active)
SELECT module_id, 'multiple_choice', $NQ$The lesson distinguishes between two voices that can address a believer over sin. According to the text, what is the difference?$NQ$, $NA${"choices":[{"id":"opt-l1m4q4o1","text":"The devil guilts, while the Holy Spirit convicts","is_correct":true},{"id":"opt-l1m4q4o2","text":"The devil convicts, while the Holy Spirit guilts","is_correct":false},{"id":"opt-l1m4q4o3","text":"Both the devil and the Holy Spirit guilt the believer","is_correct":false},{"id":"opt-l1m4q4o4","text":"Neither guilt nor conviction has any effect on the believer","is_correct":false}]}$NA$::jsonb, $NC$The devil guilts, while the Holy Spirit convicts$NC$, 2, TRUE
  FROM modules WHERE level_number=1 AND module_sequence_number=4;
INSERT INTO question_bank (module_id, q_type, question_text, answer_options, correct_answer, difficulty_rating, is_active)
SELECT module_id, 'multiple_choice', $NQ$The text describes the condition of man before salvation, citing Ephesians 2:1. According to the lesson, spiritual death means:$NQ$, $NA${"choices":[{"id":"opt-l1m4q5o1","text":"separation from the life of God, being cut off from God while possibly active outwardly","is_correct":true},{"id":"opt-l1m4q5o2","text":"the complete end of a person's existence","is_correct":false},{"id":"opt-l1m4q5o3","text":"a temporary loss of physical strength and health","is_correct":false},{"id":"opt-l1m4q5o4","text":"a state in which a person merely needs better advice and discipline","is_correct":false}]}$NA$::jsonb, $NC$separation from the life of God, being cut off from God while possibly active outwardly$NC$, 3, TRUE
  FROM modules WHERE level_number=1 AND module_sequence_number=4;
INSERT INTO question_bank (module_id, q_type, question_text, answer_options, correct_answer, difficulty_rating, is_active)
SELECT module_id, 'multiple_choice', $NQ$The lesson explains where and when the new birth takes place in a person. According to the text, salvation is:$NQ$, $NA${"choices":[{"id":"opt-l1m4q6o1","text":"instant in the spirit, then worked out progressively in the soul, and finally completed even in the body","is_correct":true},{"id":"opt-l1m4q6o2","text":"instant in the body first, then later worked out in the spirit","is_correct":false},{"id":"opt-l1m4q6o3","text":"a gradual change that begins in the soul and never reaches the spirit","is_correct":false},{"id":"opt-l1m4q6o4","text":"completed fully and visibly in every area on the day of conversion","is_correct":false}]}$NA$::jsonb, $NC$instant in the spirit, then worked out progressively in the soul, and finally completed even in the body$NC$, 3, TRUE
  FROM modules WHERE level_number=1 AND module_sequence_number=4;
INSERT INTO question_bank (module_id, q_type, question_text, answer_options, correct_answer, difficulty_rating, is_active)
SELECT module_id, 'multiple_choice', $NQ$The lesson addresses a believer who still struggles with old thought patterns, emotional wounds, or learned habits. According to the text, what does this struggle prove?$NQ$, $NA${"choices":[{"id":"opt-l1m4q7o1","text":"that sanctification is now needed, not that the new birth is false","is_correct":true},{"id":"opt-l1m4q7o2","text":"that the new birth never actually happened","is_correct":false},{"id":"opt-l1m4q7o3","text":"that the believer's spirit was not made new","is_correct":false},{"id":"opt-l1m4q7o4","text":"that the believer has lost his sonship and must be saved again","is_correct":false}]}$NA$::jsonb, $NC$that sanctification is now needed, not that the new birth is false$NC$, 4, TRUE
  FROM modules WHERE level_number=1 AND module_sequence_number=4;
INSERT INTO question_bank (module_id, q_type, question_text, answer_options, correct_answer, difficulty_rating, is_active)
SELECT module_id, 'multiple_choice', $NQ$The lesson teaches on the believer's restored authority, referencing passages such as Mark 16:17–18. According to the text, this authority is:$NQ$, $NA${"choices":[{"id":"opt-l1m4q8o1","text":"not self-generated, but exercised in Christ's name, under His lordship, and by faith in what He accomplished","is_correct":true},{"id":"opt-l1m4q8o2","text":"self-generated power that the believer produces by his own strength","is_correct":false},{"id":"opt-l1m4q8o3","text":"a fight to win Christ's victory that has not yet been achieved","is_correct":false},{"id":"opt-l1m4q8o4","text":"lawful dominion that the devil still holds over the believer","is_correct":false}]}$NA$::jsonb, $NC$not self-generated, but exercised in Christ's name, under His lordship, and by faith in what He accomplished$NC$, 4, TRUE
  FROM modules WHERE level_number=1 AND module_sequence_number=4;
INSERT INTO question_bank (module_id, q_type, question_text, answer_options, correct_answer, difficulty_rating, is_active)
SELECT module_id, 'multiple_choice', $NQ$The lesson explains what happens when a Christian sins. According to the text, when a Christian sins, that sin:$NQ$, $NA${"choices":[{"id":"opt-l1m4q9o1","text":"does not become his identity but contradicts it, disrupting fellowship without erasing sonship","is_correct":true},{"id":"opt-l1m4q9o2","text":"becomes his new and deepest identity","is_correct":false},{"id":"opt-l1m4q9o3","text":"permanently erases his sonship and standing before God","is_correct":false},{"id":"opt-l1m4q9o4","text":"may be excused freely because identity in Christ is settled","is_correct":false}]}$NA$::jsonb, $NC$does not become his identity but contradicts it, disrupting fellowship without erasing sonship$NC$, 5, TRUE
  FROM modules WHERE level_number=1 AND module_sequence_number=4;
INSERT INTO question_bank (module_id, q_type, question_text, answer_options, correct_answer, difficulty_rating, is_active)
SELECT module_id, 'multiple_choice', $NQ$The lesson repeatedly contrasts identity and growth, summarizing the Christian life. According to the text, which statement best captures its core teaching?$NQ$, $NA${"choices":[{"id":"opt-l1m4q10o1","text":"Identity in Christ is already settled, and the Christian life is learning to live outwardly from what God already did inwardly","is_correct":true},{"id":"opt-l1m4q10o2","text":"Identity in Christ is gradually earned as a believer's conduct improves over time","is_correct":false},{"id":"opt-l1m4q10o3","text":"Growth in the soul must be complete before a believer's identity can change","is_correct":false},{"id":"opt-l1m4q10o4","text":"A believer's identity is built from his feelings, past, tribe, wounds, and failures","is_correct":false}]}$NA$::jsonb, $NC$Identity in Christ is already settled, and the Christian life is learning to live outwardly from what God already did inwardly$NC$, 5, TRUE
  FROM modules WHERE level_number=1 AND module_sequence_number=4;

-- ===== Level 1 · Module 5: The Word of God =====
INSERT INTO modules (level_number, module_sequence_number, title, lesson_content, evaluation_kind, estimated_minutes, quiz_pass_mark, status)
VALUES (1, 5, $NT$The Word of God$NT$, $NB$Truth + Confidence
Lesson Objective

By the end of this lesson, the disciple should be able to:

   ●​ understand what the Bible means by the Word of God,

   ●​ know the relationship between Jesus and the Word,

   ●​ explain why God’s Word is truth,

   ●​ trust the integrity and reliability of Scripture,

   ●​ understand the basic structure and classification of the Bible,

   ●​ and begin building a daily culture of prayer and Scripture.

Introduction: Why the Word Matters

Module 1 taught us about God and His nature. Module 2 showed us God’s plan for

humanity and the fall of man. Module 3 explained salvation by grace. Module 4

established our identity in Christ. Now Module 5 answers another vital question:

How does the believer grow in truth, stability, and confidence after salvation?

The answer is the Word of God.

A believer cannot live strongly without the Word. He may be sincere, emotional,

gifted, or zealous, but if he is not grounded in the Word, he will remain unstable. The

Word of God is not an optional extra for serious Christians. It is the foundation of

spiritual life, growth, clarity, discernment, and confidence.

God does not intend for His people to live on guesswork. He intends for them to live

by truth.

Now you know: The Christian life is not sustained by feelings alone. It is built and

strengthened by the Word of God.
Quick Truths

   ●​ The Word of God is essential for growth.

   ●​ Truth produces confidence.

   ●​ A believer without the Word becomes unstable.

   ●​ God grows His people through truth.

The Word and Jesus Christ

The Bible shows us that Jesus is not separate from the Word. He is revealed as the

eternal Word.

John 1:1–2 says:​

“In the beginning was the Word, and the Word was with God, and the Word was

God. He was with God in the beginning.”

John 1 continues by showing that through Him all things were made, and later

declares that the Word became flesh. This means Jesus is not merely a messenger

who brought truth. He is Himself the eternal Word revealed.

This matters deeply because the believer must never think of Scripture as dry

information detached from Christ. The written Word reveals the living Word. The

Scriptures bear witness to Christ, and Christ is made known through the Scriptures.

John 17:17 says:​

“Sanctify them through thy truth: thy word is truth.”

That means the Word of God is not opinion, suggestion, or mere inspiration. It is truth.

And because it is truth, it sanctifies, cleanses, corrects, builds, and stabilizes the

believer.
Now you know: To know the Word rightly is to be led into the knowledge of Christ,

and to know Christ truly is to love His Word.

Quick Truths

   ●​ Jesus is the eternal Word.

   ●​ The written Word reveals the living Word.

   ●​ God’s Word is truth.

   ●​ Truth sanctifies the believer.

The Word of Truth

The phrase “word of truth” in Scripture refers to the Gospel and, by extension, the

whole counsel of God given in Scripture. It is the message by which men are saved,

taught, corrected, established, and set free.

The Bible describes the Word as:

   ●​ holy,

   ●​ active,

   ●​ life-giving,

   ●​ foundational,

   ●​ and liberating.

Ephesians 1:13 calls the gospel “the word of truth.”​

James 1:18 says we are brought forth by “the word of truth.”​

2 Timothy 2:15 instructs the believer to rightly divide or rightly handle “the word of

truth.”

This means truth is not merely something to admire. It must be received, understood,

handled correctly, and lived.
A man may be passionate and still be wrong. A man may be loud and still be

empty. But a believer anchored in the Word of truth becomes stable, accurate, and

fruitful.

Now you know: The Word of truth does not only inform the mind. It shapes the life.

Key verses on the Word of Truth

    ●​ John 17:17 — “Sanctify them in the truth; your word is truth.”

    ●​ Psalm 119:160 — “The entirety of your word is truth, and every righteous rule

            endures forever.”

    ●​ Ephesians 1:13 — “…the word of truth, the gospel of your salvation…”

    ●​ 2 Timothy 2:15 — “…rightly handling the word of truth.”

    ●​ Hebrews 4:12 — “For the word of God is living and active…”

    ●​ James 1:18 — “Of his own will he brought us forth by the word of truth…”

Truth Sets the Believer Free

Jesus said in John 8:32:​

“And you will know the truth, and the truth will set you free.”

Freedom in Scripture is not produced by ignorance, hype, or emotional excitement.

Freedom is tied to truth. Where truth is absent, bondage thrives. Where truth enters,

light enters. And where light enters, deception begins to lose its grip.
This is why the Word of God is so central to discipleship. A disciple must be taught the

truth until his thoughts, responses, choices, and convictions are shaped by God’s

mind.

Jesus also said in John 14:6:​

“I am the way, the truth, and the life…”

Truth is not merely a system of ideas. Truth is fully embodied in Christ and faithfully

revealed in His Word.

Psalm 119:105 says:​

“Your word is a lamp to my feet and a light to my path.”

That means the Word gives direction. It shows the next step. It exposes danger. It

keeps the believer from wandering blindly.

Now you know: Truth is not a decoration for the Christian life. It is the light by which

the believer walks.

Quick Truths

   ●​ Truth exposes deception.

   ●​ Truth produces freedom.

   ●​ Truth gives direction.

   ●​ Truth keeps the believer steady.

The Integrity of God’s Word

One of the greatest foundations of confidence in the Christian life is this: God’s Word

can be trusted fully.

Psalm 119:89 says:​

“For ever, O LORD, thy word is settled in heaven.”
This means God’s Word is fixed, established, and not subject to the instability of man.

Numbers 23:19 says that God is not a man that He should lie, nor a son of man that

He should repent. If He has spoken, He will act. If He has said it, He will bring it to

pass.

Isaiah 40:8 says:​

“The grass withers, the flower fades, but the word of our God will stand forever.”

Hebrews 4:12 says the Word of God is living and powerful, sharper than any

two-edged sword. Psalm 119:140 says God’s Word is very pure.

This means the Word of God is:

   ●​ unchanging,

   ●​ trustworthy,

   ●​ active,

   ●​ piercing,

   ●​ and pure.

The believer therefore approaches Scripture with confidence, not suspicion. God’s

Word does not decay. It does not expire. It does not weaken with time. It stands.

Now you know: You can build your life on the Word of God without fear of collapse.

Quick Truths

   ●​ God’s Word is settled.

   ●​ God’s Word does not lie.

   ●​ God’s Word stands forever.

   ●​ God’s Word is living and pure.
Understanding the Bible

The Bible is a collection of 66 books written over time by human authors under divine

inspiration. It is divided into two main testaments:

   ●​ Old Testament — 39 books

   ●​ New Testament — 27 books

The Old Testament was written primarily in Hebrew and covers creation, the

patriarchs, Israel’s history, the law, wisdom literature, and the prophets. The New

Testament was written in Greek and covers the life of Jesus, the early church,

apostolic teaching, and prophecy concerning the end and the victory of God.

The Bible is not arranged strictly in chronological order. It is arranged largely by type,

genre, and function.

This is important because many believers feel overwhelmed when they open the

Bible simply because they do not understand how it is arranged.

Now you know: The Bible is one divine story revealed through many books, genres,

and writers.

Structure and Divisions of the Bible

The Old Testament

The Old Testament contains 39 books and covers:

   ●​ creation,

   ●​ the fall,
   ●​ the patriarchs,

   ●​ the covenant with Israel,

   ●​ the law,

   ●​ Israel’s history,

   ●​ wisdom literature,

   ●​ and the prophets.

The New Testament

The New Testament contains 27 books and covers:

   ●​ the life, death, and resurrection of Jesus Christ,

   ●​ the birth and growth of the early church,

   ●​ apostolic teaching to believers,

   ●​ and prophetic revelation concerning the end.

Quick Truths

   ●​ The Bible has 66 books.

   ●​ The Old Testament has 39 books.

   ●​ The New Testament has 27 books.

   ●​ The Bible is arranged by kind of writing and purpose, not only by timeline.

Classifications of the Old Testament Books

The Old Testament books can be grouped into major sections:

The Law

Also called the Pentateuch or Torah:
   ●​ Genesis

   ●​ Exodus

   ●​ Leviticus

   ●​ Numbers

   ●​ Deuteronomy

These books cover creation, the patriarchs, the beginning of God’s dealings with

Israel, and the giving of the law through Moses.

History

These books run from Joshua to Esther. They record Israel’s history in the land, the

judges, the kings, the division of the kingdom, exile, and return.

Wisdom and Poetry

These books are:

   ●​ Job

   ●​ Psalms

   ●​ Proverbs

   ●​ Ecclesiastes

   ●​ Song of Solomon

They give wisdom, worship, reflection, practical instruction, and insight into the

human experience before God.

Major Prophets

These are:

   ●​ Isaiah

   ●​ Jeremiah

   ●​ Lamentations
   ●​ Ezekiel

   ●​ Daniel

They are called “major” because of their length and scope, not because they are

more inspired than the others.

Minor Prophets

These are the twelve shorter prophetic books from Hosea to Malachi.

Now you know: Every part of the Old Testament contributes to God’s unfolding plan

and prepares the way for Christ.

Classifications of the New Testament Books

The New Testament books can also be grouped clearly:

The Gospels

   ●​ Matthew

   ●​ Mark

   ●​ Luke

   ●​ John

These reveal the life, ministry, death, and resurrection of Jesus Christ.

History

   ●​ Acts of the Apostles
Acts records the birth, growth, and spread of the early Church by the power of the

Holy Spirit.

Pauline Epistles

These are the letters written by Paul, from Romans to Philemon. They teach doctrine,

correction, church life, grace, faith, holiness, and practical Christian living.

General Epistles

These run from Hebrews to Jude. They are letters written to believers more broadly by

other leaders and servants of God.

Prophecy / Apocalyptic

    ●​ Revelation

This book reveals the triumph of Christ, the judgment of evil, and the final victory of

God.

Now you know: The New Testament shows Christ revealed, Christ preached, Christ

explained, and Christ victorious.

Learning the Language: Prayer and Scripture

God is explicit about the importance of believers cultivating a Word culture. He

desires that His people be filled with the Word because it is the material by which

they are built up and led into their inheritance in Christ.
Acts 20:32 says:​

“And now, brethren, I commend you to God, and to the word of his grace, which is

able to build you up, and to give you an inheritance among all them which are

sanctified.”

That verse is powerful. It shows that the Word:

   ●​ builds the believer,

   ●​ strengthens the believer,

   ●​ and leads the believer into his inheritance.

So the question becomes: How do we cultivate a Word culture?

Many believers want to read the Bible, but they struggle with consistency. Some do

not know where to begin. Others start well and stop. Others read without

understanding and become discouraged.

The answer is not to turn Bible reading into a burden. The answer is to build a living

habit of prayer and Scripture.

Now you know: A strong believer is not merely inspired occasionally. He is built

steadily by prayer and the Word.

How to Build a Word Culture

There is no single rigid formula for studying the Bible, but there are wise patterns that

help a believer grow.

How to read
   ●​ Read daily, even if you begin with small portions.

   ●​ Read prayerfully, not mechanically.

   ●​ Read with the intention to understand.

   ●​ Read in context, not just in fragments.

   ●​ Read consistently enough for the Word to shape your thinking.

How to pray

   ●​ Ask the Lord for understanding.

   ●​ Pray the Scriptures back to God.

   ●​ Respond to what you read with worship, repentance, thanksgiving, and

      obedience.

   ●​ Let prayer and Scripture work together, not separately.

How to grow daily

   ●​ Return to the Word every day.

   ●​ Meditate on what God has said.

   ●​ Speak the truth over your life.

   ●​ Obey what you understand.

   ●​ Stay teachable and consistent.

A believer grows not merely by touching the Bible occasionally, but by living in

contact with the Word continually.

Now you know: Growth in the Word is not built by random passion. It is built by daily

contact, prayerful attention, and obedience.

Quick Truths

   ●​ Read the Word daily.

   ●​ Pray with the Word open.

   ●​ Ask questions and seek understanding.
   ●​ Obey what God shows you.

   ●​ Consistency is stronger than occasional intensity.

Key Priorities in Gaining Knowledge

Not all Bible reading produces equal growth. A disciple must approach the Word

with the right priorities.

Know God, not just information

The goal of Scripture is not to make you merely informed. It is to bring you into the

knowledge of God.

Grow in truth, not error

The believer must handle the Word carefully and correctly. Wrong handling

produces confusion. Right handling produces health.

Build confidence through revelation

Confidence in the Christian life grows when truth becomes settled in the heart.

Let the Word shape conduct

Knowledge that does not affect life has not yet matured properly. The Word must

move from hearing to believing to doing.

Stay in the Word long enough to be changed

The Word does not always transform a man in one sitting. But over time it renews the

mind, purifies the heart, strengthens faith, and changes conduct.
Now you know: The goal is not to visit the Word occasionally. The goal is to become

a man or woman shaped by it.

Reflection and Action

Reflect

   ●​ Do I treat the Word as essential or optional?

   ●​ Do I read Scripture to know God or only to solve problems?

   ●​ Am I building a steady Word culture or living on spiritual leftovers?

   ●​ Is the truth of God’s Word shaping my confidence and daily choices?

Action

Write these lines and pray through them:

   ●​ God’s Word is truth.

   ●​ Jesus is revealed through the Word.

   ●​ The Word of God builds me up.

   ●​ The Word of God gives me light and direction.

   ●​ I will grow in daily Scripture and prayer.

   ●​ I will handle the Word carefully and truthfully.

   ●​ I will let the Word shape my mind, my speech, and my walk.

   ●​ By the grace of God, I will build a strong Word culture.

Quick Class Takeaway
   ●​ The Word of God is truth.

   ●​ Jesus is the eternal Word revealed.

   ●​ The Word of truth brings salvation, sanctification, stability, and freedom.

   ●​ Truth sets the believer free.

   ●​ God’s Word is settled, pure, living, and unchanging.

   ●​ The Bible has 66 books divided into Old and New Testaments.

   ●​ The Bible is arranged by genre and purpose.

   ●​ The believer must learn the structure of Scripture so he can handle it with

      confidence.

   ●​ Prayer and Scripture must work together in daily Christian living.

   ●​ A Word culture is built by consistency, prayer, understanding, and obedience.$NB$, 'quiz', 17, 70, 'published')
ON CONFLICT (level_number, module_sequence_number) DO UPDATE SET
  title = EXCLUDED.title, lesson_content = EXCLUDED.lesson_content, evaluation_kind = EXCLUDED.evaluation_kind,
  estimated_minutes = EXCLUDED.estimated_minutes, quiz_pass_mark = EXCLUDED.quiz_pass_mark,
  status = 'published', updated_at = now();
DELETE FROM question_bank WHERE module_id = (SELECT module_id FROM modules WHERE level_number=1 AND module_sequence_number=5);
INSERT INTO question_bank (module_id, q_type, question_text, answer_options, correct_answer, difficulty_rating, is_active)
SELECT module_id, 'multiple_choice', $NQ$Module 5 teaches that the believer grows in truth, stability, and confidence after salvation through one foundational source. According to the lesson, what is the answer to how a believer grows after salvation?$NQ$, $NA${"choices":[{"id":"opt-l1m5q1o1","text":"The Word of God","is_correct":true},{"id":"opt-l1m5q1o2","text":"Strong emotions and zeal alone","is_correct":false},{"id":"opt-l1m5q1o3","text":"Natural gifts and talents","is_correct":false},{"id":"opt-l1m5q1o4","text":"Sincere guesswork about God","is_correct":false}]}$NA$::jsonb, $NC$The Word of God$NC$, 1, TRUE
  FROM modules WHERE level_number=1 AND module_sequence_number=5;
INSERT INTO question_bank (module_id, q_type, question_text, answer_options, correct_answer, difficulty_rating, is_active)
SELECT module_id, 'multiple_choice', $NQ$The lesson describes the overall makeup of the Bible. According to the text, how many books does the Bible contain in total?$NQ$, $NA${"choices":[{"id":"opt-l1m5q2o1","text":"It contains 66 books","is_correct":true},{"id":"opt-l1m5q2o2","text":"It contains 39 books","is_correct":false},{"id":"opt-l1m5q2o3","text":"It contains 27 books","is_correct":false},{"id":"opt-l1m5q2o4","text":"It contains 12 books","is_correct":false}]}$NA$::jsonb, $NC$It contains 66 books$NC$, 1, TRUE
  FROM modules WHERE level_number=1 AND module_sequence_number=5;
INSERT INTO question_bank (module_id, q_type, question_text, answer_options, correct_answer, difficulty_rating, is_active)
SELECT module_id, 'multiple_choice', $NQ$John 1:1-2 is quoted to show the relationship between Jesus and the Word. According to the lesson, how is Jesus described in relation to the Word?$NQ$, $NA${"choices":[{"id":"opt-l1m5q3o1","text":"He is the eternal Word revealed, not merely a messenger who brought truth","is_correct":true},{"id":"opt-l1m5q3o2","text":"He is only a messenger who delivered God's truth to people","is_correct":false},{"id":"opt-l1m5q3o3","text":"He is separate from the Word and stands apart from Scripture","is_correct":false},{"id":"opt-l1m5q3o4","text":"He is one of several prophets who spoke God's words","is_correct":false}]}$NA$::jsonb, $NC$He is the eternal Word revealed, not merely a messenger who brought truth$NC$, 2, TRUE
  FROM modules WHERE level_number=1 AND module_sequence_number=5;
INSERT INTO question_bank (module_id, q_type, question_text, answer_options, correct_answer, difficulty_rating, is_active)
SELECT module_id, 'multiple_choice', $NQ$The lesson divides the Bible into two testaments and gives the book count of each. According to the text, how are the books distributed between the testaments?$NQ$, $NA${"choices":[{"id":"opt-l1m5q4o1","text":"The Old Testament has 39 books and the New Testament has 27 books","is_correct":true},{"id":"opt-l1m5q4o2","text":"The Old Testament has 27 books and the New Testament has 39 books","is_correct":false},{"id":"opt-l1m5q4o3","text":"The Old Testament has 33 books and the New Testament has 33 books","is_correct":false},{"id":"opt-l1m5q4o4","text":"The Old Testament has 39 books and the New Testament has 39 books","is_correct":false}]}$NA$::jsonb, $NC$The Old Testament has 39 books and the New Testament has 27 books$NC$, 2, TRUE
  FROM modules WHERE level_number=1 AND module_sequence_number=5;
INSERT INTO question_bank (module_id, q_type, question_text, answer_options, correct_answer, difficulty_rating, is_active)
SELECT module_id, 'multiple_choice', $NQ$Quoting John 8:32, the lesson explains the connection between truth and freedom. According to the text, how is freedom related to truth?$NQ$, $NA${"choices":[{"id":"opt-l1m5q5o1","text":"Freedom is tied to truth, and where truth enters, deception begins to lose its grip","is_correct":true},{"id":"opt-l1m5q5o2","text":"Freedom is produced by emotional excitement and hype","is_correct":false},{"id":"opt-l1m5q5o3","text":"Freedom comes through ignorance of difficult matters","is_correct":false},{"id":"opt-l1m5q5o4","text":"Freedom is achieved mainly through zeal and passion","is_correct":false}]}$NA$::jsonb, $NC$Freedom is tied to truth, and where truth enters, deception begins to lose its grip$NC$, 3, TRUE
  FROM modules WHERE level_number=1 AND module_sequence_number=5;
INSERT INTO question_bank (module_id, q_type, question_text, answer_options, correct_answer, difficulty_rating, is_active)
SELECT module_id, 'multiple_choice', $NQ$The lesson notes that the Bible is not laid out in a simple time sequence. According to the text, how is the Bible primarily arranged?$NQ$, $NA${"choices":[{"id":"opt-l1m5q6o1","text":"By type, genre, and function rather than strictly by chronology","is_correct":true},{"id":"opt-l1m5q6o2","text":"Strictly in the chronological order events occurred","is_correct":false},{"id":"opt-l1m5q6o3","text":"Alphabetically by the names of the books","is_correct":false},{"id":"opt-l1m5q6o4","text":"By the length of each book from longest to shortest","is_correct":false}]}$NA$::jsonb, $NC$By type, genre, and function rather than strictly by chronology$NC$, 3, TRUE
  FROM modules WHERE level_number=1 AND module_sequence_number=5;
INSERT INTO question_bank (module_id, q_type, question_text, answer_options, correct_answer, difficulty_rating, is_active)
SELECT module_id, 'multiple_choice', $NQ$The section on the Major Prophets lists Isaiah, Jeremiah, Lamentations, Ezekiel, and Daniel. According to the lesson, why are these called 'major'?$NQ$, $NA${"choices":[{"id":"opt-l1m5q7o1","text":"Because of their length and scope, not because they are more inspired than the others","is_correct":true},{"id":"opt-l1m5q7o2","text":"Because they are more inspired than the other prophetic books","is_correct":false},{"id":"opt-l1m5q7o3","text":"Because they were written before all the other prophets","is_correct":false},{"id":"opt-l1m5q7o4","text":"Because they contain the most prophecies about the end times","is_correct":false}]}$NA$::jsonb, $NC$Because of their length and scope, not because they are more inspired than the others$NC$, 4, TRUE
  FROM modules WHERE level_number=1 AND module_sequence_number=5;
INSERT INTO question_bank (module_id, q_type, question_text, answer_options, correct_answer, difficulty_rating, is_active)
SELECT module_id, 'multiple_choice', $NQ$The lesson describes the integrity of God's Word using passages such as Psalm 119:89, Numbers 23:19, and Isaiah 40:8. Which statement best captures the lesson's conclusion about the trustworthiness of God's Word?$NQ$, $NA${"choices":[{"id":"opt-l1m5q8o1","text":"It is unchanging and stands forever, so the believer approaches it with confidence, not suspicion","is_correct":true},{"id":"opt-l1m5q8o2","text":"It is reliable now but may weaken and expire over long periods of time","is_correct":false},{"id":"opt-l1m5q8o3","text":"It should be approached with suspicion until each part is personally proven","is_correct":false},{"id":"opt-l1m5q8o4","text":"It is subject to the instability of man and changes with circumstances","is_correct":false}]}$NA$::jsonb, $NC$It is unchanging and stands forever, so the believer approaches it with confidence, not suspicion$NC$, 4, TRUE
  FROM modules WHERE level_number=1 AND module_sequence_number=5;
INSERT INTO question_bank (module_id, q_type, question_text, answer_options, correct_answer, difficulty_rating, is_active)
SELECT module_id, 'multiple_choice', $NQ$Under 'Key Priorities in Gaining Knowledge,' the lesson stresses that knowledge must mature into action. According to the text, what is the danger of knowledge that does not affect the believer's life?$NQ$, $NA${"choices":[{"id":"opt-l1m5q9o1","text":"It has not yet matured properly; the Word must move from hearing to believing to doing","is_correct":true},{"id":"opt-l1m5q9o2","text":"It is automatically complete once the believer understands it correctly","is_correct":false},{"id":"opt-l1m5q9o3","text":"It guarantees transformation in a single sitting regardless of conduct","is_correct":false},{"id":"opt-l1m5q9o4","text":"It produces health and stability even without obedience","is_correct":false}]}$NA$::jsonb, $NC$It has not yet matured properly; the Word must move from hearing to believing to doing$NC$, 5, TRUE
  FROM modules WHERE level_number=1 AND module_sequence_number=5;
INSERT INTO question_bank (module_id, q_type, question_text, answer_options, correct_answer, difficulty_rating, is_active)
SELECT module_id, 'multiple_choice', $NQ$The lesson on building a Word culture contrasts two ways of relating to Scripture and cites Acts 20:32 about the Word building the believer. According to the text, how does a believer actually grow strong in the Word?$NQ$, $NA${"choices":[{"id":"opt-l1m5q10o1","text":"By daily contact, prayerful attention, and obedience, since consistency is stronger than occasional intensity","is_correct":true},{"id":"opt-l1m5q10o2","text":"By random passion and bursts of occasional intense reading","is_correct":false},{"id":"opt-l1m5q10o3","text":"By touching the Bible occasionally whenever inspiration strikes","is_correct":false},{"id":"opt-l1m5q10o4","text":"By reading large amounts quickly without praying or seeking understanding","is_correct":false}]}$NA$::jsonb, $NC$By daily contact, prayerful attention, and obedience, since consistency is stronger than occasional intensity$NC$, 5, TRUE
  FROM modules WHERE level_number=1 AND module_sequence_number=5;

-- ===== Level 1 · Module 6: The Fellowship =====
INSERT INTO modules (level_number, module_sequence_number, title, lesson_content, evaluation_kind, estimated_minutes, quiz_pass_mark, status)
VALUES (1, 6, $NT$The Fellowship$NT$, $NB$(Shared Life with God and His People)​

Key Scripture: Acts 2:42

Acts 2:42 (NKJV)​

“And they continued steadfastly in the apostles’ doctrine and fellowship, in the

breaking of bread, and in prayers.”
Topic Outline

   ●​ Definition

   ●​ First Mention

   ●​ Types of Fellowship

   ●​ The Nature of Fellowship

   ●​ The Purpose of Fellowship

   ●​ The Benefits of Fellowship

   ●​ Common Misunderstandings and Abuse of Fellowship

1) Definition

Fellowship signifies a deep, spiritual, and communal participation, often called

Koinonia—a shared life.

It is more than companionship. It is more than being in the same room. It is more

than friendship in the natural sense. Fellowship is sharing in common, communion,

and participation in the life of God and in the life of His people.

Fellowship can be described as:

   ●​ companionship

   ●​ communion

   ●​ participation

   ●​ a company of equals or friends

   ●​ shared life in Christ

In simple terms, fellowship has a twofold and inseparable relationship:

   1.​ A vertical connection with God

   2.​ A horizontal unity among believers
True fellowship is characterized by shared faith, mutual encouragement, love,

prayer, truth, and shared resources.

Catch this: Fellowship is not just gathering together—it is sharing life in God together.

Fellowship is not merely social interaction. It is spiritual participation. It is the life of

God flowing between God and man, and then among men who belong to God.

In simple words:

   ●​ Fellowship is shared life.

   ●​ Fellowship is communion with God and with believers.

   ●​ Fellowship is deeper than friendship; it is spiritual participation.

2) First Mention

The first man the Bible explicitly presents as living in fellowship with God is Enoch.

Genesis 5:22–24 (NLT)​

“After the birth of Methuselah, Enoch lived in close fellowship with God for another

300 years, and he had other sons and daughters. Enoch lived 365 years, walking in

close fellowship with God. Then one day he disappeared, because God took him.”

With Adam, fellowship with God is implied in Genesis 3:8, where the voice of the Lord

is heard in the garden. But with Enoch, the Bible states it clearly and intentionally: he

walked with God.

This shows that fellowship is not a casual event. It is a walk. It is daily. It is relational. It

is intentional. Enoch did not only know about God—he lived in close relationship with

God.

Catch this: Fellowship is not an occasional visit with God—it is a walk with God.
In the New Testament, fellowship is also seen in the ministry of Jesus with His disciples.

The Lord did not merely teach them from a distance. He lived with them, corrected

them, ate with them, prayed with them, and shared life with them.

John 13:8 (KJV)​

“Peter saith unto him, Thou shalt never wash my feet. Jesus answered him, If I wash

thee not, thou hast no part with me.”

Here, the Lord was speaking of shared participation, communion, and belonging.

Fellowship involves having a part with Christ.

In simple words:

   ●​ Enoch is the first man explicitly shown in close fellowship with God.

   ●​ Fellowship is a walk, not just a meeting.

   ●​ In Christ, fellowship becomes deeper and more personal.

3) Types of Fellowship

There are three major types of fellowship in the Christian life.

i.) Vertical Fellowship: Between God and Man

This is the believer’s communion with God. It is the personal relationship of man with

God in prayer, worship, obedience, and communion.

Genesis 5:22 (NLT)​

“After the birth of Methuselah, Enoch lived in close fellowship with God for another

300 years, and he had other sons and daughters.”

Numbers 12:7–8 (KJV)​

“My servant Moses is not so, who is faithful in all mine house. With him will I speak
mouth to mouth, even apparently, and not in dark speeches; and the similitude of

the Lord shall he behold…”

Vertical fellowship is seen in men like Enoch, Moses, David, and the prophets—men

who walked with God, heard God, and lived in His presence.

ii.) Horizontal Fellowship: Among the Brethren

This is fellowship among believers. It is the shared life of the church in doctrine,

prayer, encouragement, love, correction, and mutual care.

Acts 2:42 (NKJV)​

“And they continued steadfastly in the apostles’ doctrine and fellowship, in the

breaking of bread, and in prayers.”

Hebrews 10:25 (NLT)​

“And let us not neglect our meeting together, as some people do, but encourage

one another, especially now that the day of his return is drawing near.”

1 John 1:6–7 (NLT)​

“So we are lying if we say we have fellowship with God but go on living in spiritual

darkness; we are not practicing the truth. But if we are living in the light, as God is in

the light, then we have fellowship with each other, and the blood of Jesus, his Son,

cleanses us from all sin.”

This shows that true fellowship with God should produce true fellowship with one

another.

iii.) Corporate Fellowship: The Church with Christ

This is when the people of God come together before the Lord to minister to Him

and hear from Him together. This is both vertical and corporate.
Acts 13:2–3 (NKJV)​

“As they ministered to the Lord and fasted, the Holy Spirit said, ‘Now separate to Me

Barnabas and Saul for the work to which I have called them.’ Then, having fasted

and prayed, and laid hands on them, they sent them away.”

Deuteronomy 10:8 (NKJV)​

“At that time the Lord separated the tribe of Levi to bear the ark of the covenant of

the Lord, to stand before the Lord to minister to Him and to bless in His name, to this

day.”

This kind of fellowship is not man-centered. It is gathered worship, prayer, listening,

and response before the Lord.

Catch this: Fellowship is personal, mutual, and corporate. It is you with God,

believers with one another, and the church before the Lord.

In simple words:

   ●​ Vertical fellowship is between God and man.

   ●​ Horizontal fellowship is among believers.

   ●​ Corporate fellowship is the church ministering to the Lord together.

4) The Nature of Fellowship

Fellowship takes different expressions, but its nature remains spiritual, relational, and

Christ-centered.

a.) Interpersonal Fellowship

This is when believers speak to one another in the fear of God and stir one another

toward faithfulness.
Malachi 3:16–18 (NLT)​

“Then those who feared the Lord spoke with each other, and the Lord listened to

what they said. In his presence, a scroll of remembrance was written to record the

names of those who feared him and always thought about the honor of his name.

‘They will be my people,’ says the Lord of Heaven’s Armies. ‘On the day when I act

in judgment, they will be my own special treasure. I will spare them as a father spares

an obedient child. Then you will again see the difference between the righteous

and the wicked, between those who serve God and those who do not.’”

This shows that godly conversation is not small before God. He listens to it. He values

it.

b.) House Fellowship

Fellowship can take place in homes. The early church met from house to house,

sharing meals, prayer, and joy together.

Acts 2:46 (NLT)​

“They worshiped together at the Temple each day, met in homes for the Lord’s

Supper, and shared their meals with great joy and generosity—”

House fellowship is intimate, relational, and practical. It allows believers to grow

closely together.

c.) Small Bible Studies

Fellowship also happens in smaller teaching settings where believers are grounded in

truth.

Acts 19:9–10 (NLT)​

“But some became stubborn, rejecting his message and publicly speaking against

the Way. So Paul left the synagogue and took the believers with him. Then he held

daily discussions at the lecture hall of Tyrannus. This went on for the next two years, so
that people throughout the province of Asia—both Jews and Greeks—heard the

word of the Lord.”

This shows that fellowship includes learning, discussion, and sustained teaching.

d.) Church Services

Fellowship also happens in gathered church meetings, where the body ministers

before the Lord and to one another.

1 Corinthians 14:26 (AMP)​

“What then is the right course, believers? When you meet together, each one has a

psalm, a teaching, a revelation, a tongue, or an interpretation. Let everything be

constructive and edifying and done for the good of all the church.”

Catch this: Fellowship is not confined to one place. It can happen in personal

conversation, in homes, in small studies, and in church gatherings.

In simple words:

   ●​ Fellowship is relational.

   ●​ Fellowship is spiritual.

   ●​ Fellowship can happen in homes, small groups, and church services.

5) The Purpose of Fellowship

Fellowship has clear spiritual purposes. It is not an empty religious activity.

a.) Ministering to the Lord

One major purpose of fellowship is to minister to the Lord.
Acts 13:2–3 (NKJV)​

“As they ministered to the Lord and fasted, the Holy Spirit said, ‘Now separate to Me

Barnabas and Saul for the work to which I have called them.’ Then, having fasted

and prayed, and laid hands on them, they sent them away.”

1 Chronicles 25:1–3 (NIV)​

“David, together with the commanders of the army, set apart some of the sons of

Asaph, Heman and Jeduthun for the ministry of prophesying, accompanied by

harps, lyres and cymbals… under the supervision of their father Jeduthun, who

prophesied, using the harp in thanking and praising the Lord.”

Ministering to the Lord includes thanksgiving, praise, worship, prayer, reverence, and

yielded service before Him.

How to Minister to the Lord

It can be personal or congregational. The Lord is ministered to through:

   ●​ thanksgiving

   ●​ praise

   ●​ prayer

   ●​ songs

   ●​ music

   ●​ offerings and sacrificial giving

   ●​ obedience and reverence

1 Corinthians 14:26 (AMP)​

“What then is the right course, believers? When you meet together, each one has a

psalm, a teaching, a revelation…”

Ecclesiastes 5:1–2 (AMP)​

“Guard your steps and focus on what you are doing as you go to the house of God
and draw near to listen rather than to offer the careless or irreverent sacrifice of

fools… Do not be hasty with your mouth…”

This teaches that ministering to the Lord is not casual. It must be reverent, truthful,

and acceptable before Him.

Catch this: Fellowship is not only for receiving from God. It is also for ministering to

God.

b.) Provision for Spiritual and Physical Interpersonal Needs

Fellowship also exists so that believers may strengthen and care for one another.

This includes:

   ●​ breaking of bread

   ●​ prayer and supplication

   ●​ companionship

   ●​ encouragement

   ●​ impartation

   ●​ sharing and meeting one another’s physical needs

Acts 2:44–45 (NLT)​

“And all the believers met together in one place and shared everything they had.

They sold their property and possessions and shared the money with those in need.”

True fellowship does not only talk. It serves. It does not only gather. It gives.

In simple words:

   ●​ Fellowship ministers to the Lord.

   ●​ Fellowship strengthens believers.

   ●​ Fellowship provides spiritual and practical support.
6) Benefits of Fellowship

Fellowship brings many blessings to the believer and to the church.

Benefits of Fellowship

   1.​ Enhanced intimacy with God​

      Fellowship sharpens our awareness of God’s presence.

   2.​ Spiritual impartation​

      God often strengthens, stirs, and deposits grace through fellowship.

   3.​ Spiritual growth​

      Believers grow through truth, correction, and encouragement.

   4.​ Correction and restoration​

      Fellowship helps expose blind spots and restore the weak.

   5.​ Guardrails against deception​

      Isolation often breeds error; fellowship provides balance and safety.

   6.​ Encouragement and comfort​

      Fellowship strengthens weary hearts.

   7.​ Spiritual vibrancy​

      It keeps believers alive, active, and responsive in the things of God.

   8.​ A platform for service​

      Fellowship creates room for gifts, ministry, and practical care.

Catch this: What isolation weakens, true fellowship strengthens.

In simple words:

   ●​ Fellowship helps believers grow.

   ●​ Fellowship protects believers from drifting.

   ●​ Fellowship gives strength, correction, and encouragement.
7) Common Misunderstandings and Abuse of

Fellowship

Like many good things, fellowship can be misunderstood or abused if it loses its

spiritual center.

Common Misunderstandings and Abuse

a.) When prayer is treated as a means for material gain only

Prayer must not be reduced to a tool for comfort, personal gain, or self-centered

desires. Fellowship is not a marketplace for greed.

b.) When the coming together of believers becomes gossip and rumor

Fellowship is not for gossip, rumor-mongering, or idle talk. When gatherings become

fleshly, the purpose of fellowship is damaged.

c.) When spiritual functions are used to harm rather than bless

Spiritual gatherings must never be used for manipulation, control, intimidation, or

harm. What is meant to bless must not be turned into a weapon.

d.) When church worship services become performance

Church gatherings must not become stages for display rather than places of

genuine spiritual encounter. Worship is not entertainment. Ministry is not

performance.

e.) When duty substitutes obedience
A person may attend meetings and perform religious activity while living far from

God in the heart. Fellowship must remain sincere, living, and obedient.

Catch this: Fellowship dies when form remains but God is no longer at the center.

In simple words:

   ●​ Fellowship is not gossip.

   ●​ Fellowship is not performance.

   ●​ Fellowship is not manipulation.

   ●​ Fellowship must remain centered on God and truth.

8) Final Understanding

Fellowship is one of the great strengths of the Christian life. It joins the believer to God

and also joins believers to one another in truth, love, prayer, and shared life. It is one

of God’s ways of building strong believers and strong churches.

A believer who avoids fellowship will often grow weak, isolated, and vulnerable. But

a believer who lives in true fellowship with God and with the brethren will grow

stronger, steadier, and more fruitful.

Catch this: Fellowship is not optional to a healthy Christian life. It is part of how God

keeps believers alive, grounded, and growing.

Simple Class Takeaway

   ●​ Fellowship means shared life in God.

   ●​ Fellowship is both vertical and horizontal.
   ●​ Enoch is the first man explicitly shown walking in fellowship with God.

   ●​ Fellowship happens in homes, among believers, in Bible study, and in

       gathered church life.

   ●​ Fellowship exists to minister to the Lord and to meet the needs of believers.

   ●​ Fellowship brings growth, protection, encouragement, and spiritual strength.

   ●​ Fellowship must not be reduced to gossip, performance, or selfish gain.

Reflection & Action

Reflect:​

Are you truly living in fellowship with God and His people, or are you only attending

gatherings without shared life?

Action:​

This week, do these three things:

   1.​ Set apart personal time to fellowship with God.

   2.​ Intentionally encourage one believer in truth and prayer.

   3.​ Join a gathering of believers with the purpose to minister to the Lord and

       strengthen others.$NB$, 'quiz', 16, 70, 'published')
ON CONFLICT (level_number, module_sequence_number) DO UPDATE SET
  title = EXCLUDED.title, lesson_content = EXCLUDED.lesson_content, evaluation_kind = EXCLUDED.evaluation_kind,
  estimated_minutes = EXCLUDED.estimated_minutes, quiz_pass_mark = EXCLUDED.quiz_pass_mark,
  status = 'published', updated_at = now();
DELETE FROM question_bank WHERE module_id = (SELECT module_id FROM modules WHERE level_number=1 AND module_sequence_number=6);
INSERT INTO question_bank (module_id, q_type, question_text, answer_options, correct_answer, difficulty_rating, is_active)
SELECT module_id, 'multiple_choice', $NQ$Module 6 teaches that fellowship is often called Koinonia. According to the definition section, what does Koinonia signify?$NQ$, $NA${"choices":[{"id":"opt-l1m6q1o1","text":"A deep, spiritual, and communal participation, or a shared life","is_correct":true},{"id":"opt-l1m6q1o2","text":"A weekly meeting held only inside a church building","is_correct":false},{"id":"opt-l1m6q1o3","text":"A natural friendship between people who enjoy the same hobbies","is_correct":false},{"id":"opt-l1m6q1o4","text":"An occasional social visit between acquaintances","is_correct":false}]}$NA$::jsonb, $NC$A deep, spiritual, and communal participation, or a shared life$NC$, 1, TRUE
  FROM modules WHERE level_number=1 AND module_sequence_number=6;
INSERT INTO question_bank (module_id, q_type, question_text, answer_options, correct_answer, difficulty_rating, is_active)
SELECT module_id, 'multiple_choice', $NQ$The module names the first man the Bible explicitly presents as living in fellowship with God. Who is that man?$NQ$, $NA${"choices":[{"id":"opt-l1m6q2o1","text":"Enoch, who walked in close fellowship with God","is_correct":true},{"id":"opt-l1m6q2o2","text":"Adam, who heard the Lord's voice in the garden","is_correct":false},{"id":"opt-l1m6q2o3","text":"Moses, with whom God spoke mouth to mouth","is_correct":false},{"id":"opt-l1m6q2o4","text":"David, who set apart singers to praise the Lord","is_correct":false}]}$NA$::jsonb, $NC$Enoch, who walked in close fellowship with God$NC$, 1, TRUE
  FROM modules WHERE level_number=1 AND module_sequence_number=6;
INSERT INTO question_bank (module_id, q_type, question_text, answer_options, correct_answer, difficulty_rating, is_active)
SELECT module_id, 'multiple_choice', $NQ$The module says fellowship has a twofold and inseparable relationship. Which pair correctly describes these two dimensions?$NQ$, $NA${"choices":[{"id":"opt-l1m6q3o1","text":"A vertical connection with God and a horizontal unity among believers","is_correct":true},{"id":"opt-l1m6q3o2","text":"A private prayer life and a public reputation among neighbors","is_correct":false},{"id":"opt-l1m6q3o3","text":"An emotional bond and a financial partnership","is_correct":false},{"id":"opt-l1m6q3o4","text":"A national identity and a family bloodline","is_correct":false}]}$NA$::jsonb, $NC$A vertical connection with God and a horizontal unity among believers$NC$, 2, TRUE
  FROM modules WHERE level_number=1 AND module_sequence_number=6;
INSERT INTO question_bank (module_id, q_type, question_text, answer_options, correct_answer, difficulty_rating, is_active)
SELECT module_id, 'multiple_choice', $NQ$Module 6 lists three major types of fellowship in the Christian life. Which option correctly states what corporate fellowship is?$NQ$, $NA${"choices":[{"id":"opt-l1m6q4o1","text":"The church coming together to minister to the Lord and hear from Him together","is_correct":true},{"id":"opt-l1m6q4o2","text":"One believer's private communion with God in prayer and obedience","is_correct":false},{"id":"opt-l1m6q4o3","text":"Two believers encouraging one another in everyday conversation","is_correct":false},{"id":"opt-l1m6q4o4","text":"A casual gathering of friends sharing a meal with no spiritual aim","is_correct":false}]}$NA$::jsonb, $NC$The church coming together to minister to the Lord and hear from Him together$NC$, 2, TRUE
  FROM modules WHERE level_number=1 AND module_sequence_number=6;
INSERT INTO question_bank (module_id, q_type, question_text, answer_options, correct_answer, difficulty_rating, is_active)
SELECT module_id, 'multiple_choice', $NQ$Under the nature of fellowship, the module describes settings where it can take place. According to the text, where can fellowship happen?$NQ$, $NA${"choices":[{"id":"opt-l1m6q5o1","text":"In personal conversation, in homes, in small studies, and in church gatherings","is_correct":true},{"id":"opt-l1m6q5o2","text":"Only in formal Sunday church services led by ordained ministers","is_correct":false},{"id":"opt-l1m6q5o3","text":"Only in private, since fellowship is strictly between God and one person","is_correct":false},{"id":"opt-l1m6q5o4","text":"Only during large outdoor crusades and public revival meetings","is_correct":false}]}$NA$::jsonb, $NC$In personal conversation, in homes, in small studies, and in church gatherings$NC$, 3, TRUE
  FROM modules WHERE level_number=1 AND module_sequence_number=6;
INSERT INTO question_bank (module_id, q_type, question_text, answer_options, correct_answer, difficulty_rating, is_active)
SELECT module_id, 'multiple_choice', $NQ$The module presents 'ministering to the Lord' as one major purpose of fellowship. According to the text, what does ministering to the Lord include?$NQ$, $NA${"choices":[{"id":"opt-l1m6q6o1","text":"Thanksgiving, praise, prayer, songs, offerings, and obedience and reverence","is_correct":true},{"id":"opt-l1m6q6o2","text":"Only silent, individual meditation with no spoken words","is_correct":false},{"id":"opt-l1m6q6o3","text":"Mainly receiving material blessings and answers from God","is_correct":false},{"id":"opt-l1m6q6o4","text":"Performing impressive worship to entertain the gathered congregation","is_correct":false}]}$NA$::jsonb, $NC$Thanksgiving, praise, prayer, songs, offerings, and obedience and reverence$NC$, 3, TRUE
  FROM modules WHERE level_number=1 AND module_sequence_number=6;
INSERT INTO question_bank (module_id, q_type, question_text, answer_options, correct_answer, difficulty_rating, is_active)
SELECT module_id, 'multiple_choice', $NQ$The module distinguishes the second purpose of fellowship from merely talking, saying true fellowship 'serves' and 'gives.' What does this purpose provide for believers?$NQ$, $NA${"choices":[{"id":"opt-l1m6q7o1","text":"Provision for both spiritual and physical interpersonal needs","is_correct":true},{"id":"opt-l1m6q7o2","text":"A guarantee of wealth and material prosperity for every member","is_correct":false},{"id":"opt-l1m6q7o3","text":"A platform for individuals to display their spiritual gifts publicly","is_correct":false},{"id":"opt-l1m6q7o4","text":"Protection from ever again needing personal time alone with God","is_correct":false}]}$NA$::jsonb, $NC$Provision for both spiritual and physical interpersonal needs$NC$, 4, TRUE
  FROM modules WHERE level_number=1 AND module_sequence_number=6;
INSERT INTO question_bank (module_id, q_type, question_text, answer_options, correct_answer, difficulty_rating, is_active)
SELECT module_id, 'multiple_choice', $NQ$Among the benefits of fellowship, the module includes 'guardrails against deception.' How does the text explain this benefit?$NQ$, $NA${"choices":[{"id":"opt-l1m6q8o1","text":"Isolation often breeds error, while fellowship provides balance and safety","is_correct":true},{"id":"opt-l1m6q8o2","text":"Fellowship removes the need for sound doctrine and correction","is_correct":false},{"id":"opt-l1m6q8o3","text":"Deception is impossible for any believer who attends meetings regularly","is_correct":false},{"id":"opt-l1m6q8o4","text":"Fellowship guarantees that believers will never face spiritual blind spots","is_correct":false}]}$NA$::jsonb, $NC$Isolation often breeds error, while fellowship provides balance and safety$NC$, 4, TRUE
  FROM modules WHERE level_number=1 AND module_sequence_number=6;
INSERT INTO question_bank (module_id, q_type, question_text, answer_options, correct_answer, difficulty_rating, is_active)
SELECT module_id, 'multiple_choice', $NQ$In the section on misunderstandings and abuse, the module warns about church worship becoming performance. Which statement reflects the text's teaching on this?$NQ$, $NA${"choices":[{"id":"opt-l1m6q9o1","text":"Worship is not entertainment and ministry is not performance","is_correct":true},{"id":"opt-l1m6q9o2","text":"Performance is acceptable as long as the music is excellent","is_correct":false},{"id":"opt-l1m6q9o3","text":"Display before others is the highest goal of a church service","is_correct":false},{"id":"opt-l1m6q9o4","text":"Worship should mainly impress visitors and attract new members","is_correct":false}]}$NA$::jsonb, $NC$Worship is not entertainment and ministry is not performance$NC$, 5, TRUE
  FROM modules WHERE level_number=1 AND module_sequence_number=6;
INSERT INTO question_bank (module_id, q_type, question_text, answer_options, correct_answer, difficulty_rating, is_active)
SELECT module_id, 'multiple_choice', $NQ$The 'Catch this' line for the abuse section states that fellowship dies under a certain condition. According to the module, when does fellowship die?$NQ$, $NA${"choices":[{"id":"opt-l1m6q10o1","text":"When form remains but God is no longer at the center","is_correct":true},{"id":"opt-l1m6q10o2","text":"When believers meet in homes instead of a church building","is_correct":false},{"id":"opt-l1m6q10o3","text":"When a gathering grows too large to know everyone personally","is_correct":false},{"id":"opt-l1m6q10o4","text":"When members disagree about minor matters of doctrine","is_correct":false}]}$NA$::jsonb, $NC$When form remains but God is no longer at the center$NC$, 5, TRUE
  FROM modules WHERE level_number=1 AND module_sequence_number=6;

-- ===== Level 1 · Module 7: The Holy Spirit & Empowerment (Part 1) =====
INSERT INTO modules (level_number, module_sequence_number, title, lesson_content, evaluation_kind, estimated_minutes, quiz_pass_mark, status)
VALUES (1, 7, $NT$The Holy Spirit & Empowerment (Part 1)$NT$, $NB$As Christians, we are called into a constant fellowship with Him, because He is a

person. (2 Corinthians 13:14)

Before Jesus was revealed, man related with (heard from) God the Father

predominantly through prophets and angelic appearances. After the revealing of

Jesus the Christ, man got the opportunity to receive from God through the Word

made flesh - Jesus Christ.

After the resurrection and ascension of Christ, man relates with God predominantly

through the Holy Spirit who leads us into all truth and understanding of spiritual

matters.

The New Roommate (Part 1): Meeting the Holy Spirit

Why call Him "The New Roommate"?

A roommate shares your space. He is present in your everyday life. You wake up and

go to sleep knowing someone else lives there.

When a person believes in Christ, the Holy Spirit comes to dwell within them

permanently. He does not visit occasionally or appear only during church services.

He makes His home in the believer.

You are never alone again.

The Christian life, therefore, is not merely trying harder to obey God through human

effort.
It is learning to live in daily fellowship with the One who now lives within you. The

question becomes:

      Will you acknowledge Him?

      Will you listen to Him?

      Will you walk with Him?

The Holy Spirit as a gift of Promise from the Father.

Joel 2:28 - “It shall come about after this, that I shall pour out My Spirit on all

mankind; and your sons and your daughters will prophesy, your old men will

dream dreams, your young men will see visions.

                                                            16
John 14:15 - “If you love me, keep my commands.                  And I will ask the Father,

and he will give you another advocate to help you and be with you

forever— 17 the Spirit of truth.

Who Is the Holy Spirit?

The Holy Spirit is fully God, the third person of the Trinity. He is fully divine, co-equal

with the Father and the Son. He is not a force, a power or a feeling, He is a person

with a personality and feelings.

The Holy Spirit is:
   1.​ An advocate - Counselor, Strengthener, Standby

   2.​ Helper - Comforter, Advocate, Intercessor—, to be with you forever

   3.​ the Spirit of Truth,

The Personal Traits of the Holy Spirit

   1.​ He Loves

   2.​ He gets angry

   3.​ He gets heartbreaks and grief

               Ephesians 4: 20 - And do not grieve the Holy Spirit of God, with whom

               you were sealed for the day of redemption”. According to this

               scripture, we see that it is possible to grieve the Holy Spirit, meaning He

               has a personality.

Facts about the Holy Spirit:

   1.​ Dwells in a believer

   2.​ He empowers us to witness and to live life to the fullest

   3.​ He reveals Christ

Understanding the Holy Spirit

The Holy Spirit helps to produce the fruit - so every believer who have the Holy Spirit must
show the fruit of the Spirit
The Holy spirit gives gifts as he wills and to anyone He chooses . Gifts are not fruits, fruits
abide even when gifts are not visibly at work.

   A.​ Dwells in every Belieber.

                  i.​    At the moment of the new birth, the Holy Spirit takes up

                         residence in you. You become a temple for His residing, a living

                         temple.

                         1 Corinthians 6:19 - Do you not know that your bodies are

                         temples of the Holy Spirit, who is in you, whom you have

                         received from God? You are not your own;

                  ii.​   The residency of the Holy Spirit in us is what distinguishes us from

                         the World. According to 2 Corinthians 1:22, having the Holy Spirit

                         in you is the guarantee for your salvation.

   B.​ Seal of ownership on us 2 Corinthians 1:22, set his seal of ownership on us, and

       put his Spirit in our hearts as a deposit, guaranteeing what is to come.

       Ephesians 1:13-14 - And you also were included in Christ when you heard the

       message of truth, the gospel of your salvation. When you believed, you were

       marked in him with a seal, the promised Holy Spirit, 14 who is a deposit

       guaranteeing our inheritance until the redemption of those who are God’s

       possession—to the praise of his glory.

   C.​ Guarantee of adoption to sonship:The Holy Spirit in us is the testimony that we

       belong to God as adopted sons.

       Romans 8:15-16 says 15 The Spirit you received does not make you slaves, so

       that you live in fear again; rather, the Spirit you received brought about your

       adoption to sonship. And by him we cry, “Abba, Father.” 16 The Spirit himself

       testifies with our spirit that we are God’s children.
D.​ He empowers us to witness and to live life to the fullest

   It is impossible to live a victorious life as a Chirtian without the enabling power

   of the Holy Spirit. Acts 1:8 says “You shall receive power when the Holy Spirit

   comes upon you.” This isn’t just for preaching; it’s for living the Christian life

   victoriously, for holiness, for boldness, for discernment and for fellowship with

   God.

   Acts 2:4 4 And they were all filled with the Holy Ghost, and began to speak

   with other tongues, as the Spirit gave them utterance.

   The assignment of the disciples, which was to further preach the gospel of

   Christ out and beyond, was dependent on the enablement of the Holy Spirit.

   It is for this reason that Christ instructed them to tarry in Jerusalem until the are

   endued with the Holy Spirit.

   Acts 1:8 But you will receive power when the Holy Spirit comes on you; and

   you will be my witnesses in Jerusalem, and in all Judea and Samaria, and to

   the ends of the earth.”

E.​ He reveals Christ

   The ministry of the Holy Spirit is not to draw attention to Himself, but to glorify

   Jesus.

   John 15:26 - When the Advocate comes, whom I will send to you from the

   Father—the Spirit of truth who goes out from the Father—he will testify about

   me.

   John 16:14 - He will glorify me because it is from me that he will receive what

   he will make known to you.

   He makes the Word alive by guiding the Christian into all truth. In other words,

   the Holy Spirit points us to Jesus the Christ. This is why the bible says that the
     preaching of the cross is foolishness to those who perish; but unto us who are

     saved, it is the power of God. (1 Corinthians 1:18) It is impossible to understand

     the things of God, useless they are revealed to us by the Holy Spirit.

How to Receive the Holy Spirit

  1.​ Be Born Again - The Holy Spirit is given to those who belong to Christ
     through faith. Galatians 4:6 (KJV) “And because ye are sons, God hath sent

     forth the Spirit of his Son into your hearts, crying, Abba, Father.”

  2.​ Believe That the Holy Spirit Is God’s Promise God desires to give the
     Holy Spirit to His children. Luke 11:13 (KJV)​

     “If ye then, being evil, know how to give good gifts unto your children: how

     much more shall your heavenly Father give the Holy Spirit to them that ask

     him?”

  3.​ Ask the Father - Jesus taught believers to ask for the Holy Spirit. Luke 11:13
     (KJV) - “…how much more shall your heavenly Father give the Holy Spirit to

     them that ask him?”

  4.​ Receive by Faith The Holy Spirit is received through faith, not by works
     Galatians 3:2 (KJV) “Received ye the Spirit by the works of the law, or by the

     hearing of faith?”

  5.​ Yield Yourself to the Holy SpiritAllow Him to lead and direct your life.

     Romans 8:14 (KJV) - For as many as are led by the Spirit of God, they are

     the sons of God.

  6.​ Expect His Power and Manifestation The Holy Spirit empowers believers
     for witness and ministry. Acts 1:8 (KJV) “But ye shall receive power, after that

     the Holy Ghost will come upon you: and ye shall be witnesses unto me…”
   7.​ Allow the Holy Spirit to Give Utterance The Holy Spirit may manifest
       Himself as He wills. Acts 2:4 (KJV) “And they were all filled with the Holy Ghost,

       and began to speak with other tongues, as the Spirit gave them utterance.”

   Simple Class Takeaway

   ●​ Be born again.

   ●​ Believe God’s promise.

   ●​ Ask the Father.

   ●​ Receive by faith.

   ●​ Yield to His leadership.

   ●​ Expect His power.

   ●​ Allow Him to work through you.

Catch this: The Holy Spirit is not earned by striving; He is received by faith as God’s

gift to His children. 1: DISCIPLESHIP CLASSES - FULL COURSE.md

   ●​ t

   ●​ The Power of a Spirit-Filled Life

          1.​ You receive power when the Holy Spirit comes upon you

          2.​ You understand the heart of God

          3.​ You operate in the gifts of the Holy Spirit

          4.​ You are not easily manipulated by erroneous doctrines

          5.​ A Spirit-led life is a life directed by God’s wisdom and guidance.

          6.​ A Spirit-led life is a life empowered to overcome sin and temptation.

          7.​ A Spirit-led life is a life that reflects the character and fruit of Christ.

          8.​ A Spirit-led life is a life empowered to witness and serve effectively.

          9.​ A Spirit-led life is a life strengthened with peace, comfort, and

              endurance in every season.
The Gifts of the Holy Spirit

Spiritual gifts are grace-gifts. They are not natural talents, though God may use your

natural abilities. They are supernatural endowments given by the Holy Spirit to every

believer at the moment of salvation.

1 Corinthians 12:4-11 — "There are diversities of gifts, but the same Spirit... But one

and the same Spirit works all these things, distributing to each one individually as He

wills."

Romans 12:6-8 — "Having then gifts differing according to the grace that is given to

us..."

Ephesians 4:7-12 — "But to each one of us grace was given according to the

measure of Christ's gift."

1 Peter 4:10 — "As each one has received a gift, minister it to one another, as good

stewards of the manifold grace of God."

The Purpose of Spiritual Gifts

The gifts are not for personal glory, spiritual showmanship, or self-edification alone.

Their purposes are:

          A. To edify the Church — "for the equipping of the saints for the work of

          ministry, for the edifying of the body of Christ" (Ephesians 4:12)

          B. To manifest God's presence — "But the manifestation of the Spirit is given

          to each one for the profit of all" (1 Corinthians 12:7)
       C. To demonstrate God's power — "And my speech and my preaching were

       not with persuasive words of human wisdom, but in demonstration of the Spirit

       and of power" (1 Corinthians 2:4)

       D. To advance the Gospel — "And they went out and preached everywhere,

       the Lord working with them and confirming the word through the

       accompanying signs" (Mark 16:20)

The 9 Gifts Of The Spirit

The apostle Paul outlines nine manifest gifts of the Holy Spirit in 1 Corinthians 12:8-10.

These are traditionally grouped into three categories:

       1. Gifts of Revelation

These gifts reveal what is hidden — God's mind, plans, or supernatural knowledge.

1.1 The Word of Wisdom

It is a supernatural utterance of divine wisdom for a specific situation. It is not human

wisdom or counsel, but God's wisdom spoken into a moment. The Spirit gives you

insight into God's will or strategy that could not be known naturally.

1.2 The Word of Knowledge

It is a supernatural revelation of facts — past, present, or future — that could not be

known by natural means. The Spirit reveals specific information: a person's condition,

a future event, or even a need.

1.3 Discerning of Spirits

Discerning of Spirits is the supernatural ability to perceive the source of a spiritual

manifestation — whether it is from the Holy Spirit, a human spirit, or a demonic spirit.
With this gift, you perceive the spirit behind words, actions, or manifestations. This is

not natural suspicion or criticism — it is spiritual perception.

       2.   Gifts of Power

These gifts do what is humanly impossible — they demonstrate God's mighty power.

2.1 Faith

This gift is not the saving faith (which all believers have), but a special measure of

supernatural faith given for a specific moment to believe God for the impossible. It is

characterized by a surge of confidence in God's power rising in your spirit — you

know God will act in a particular thing, and you speak or act accordingly.

2.2 Gifts of Healings

It is the supernatural power to heal diseases and infirmities without natural means.

Note the plural "gifts" — different manifestations for different conditions. The gifts

operate through prayer, laying on of hands, anointing with oil, or even a word

spoken in faith, and by these God's healing power flows.

2.3 The Working of Miracles

This gift entails supernatural interventions that suspend or override natural law — God

doing the impossible. Through faith and the Word, circumstances are changed,

nature is commanded, and the impossible becomes possible.

       3. Gifts of Inspiration

These gifts communicate God's heart — they speak forth His mind supernaturally.

3.1 Prophecy

The gift entails speaking forth the mind of God under the inspiration of the Holy Spirit.

It is not primarily foretelling the future, but forth-telling God's heart — for edification,
exhortation, and comfort (1 Corinthians 14:3). The Spirit gives you a message to

speak. It must be judged (1 Corinthians 14:29) and aligns with Scripture.

3.2 Different Kinds of Tongues

This gift is expressed by speaking in a language unknown to the speaker — either a

human language (as in Acts 2) or a heavenly language (1 Corinthians 13:1). The Holy

Spirit gives utterance to the individual. There is a distinction between:

Private prayer language — for self-edification (1 Corinthians 14:4; Jude 1:20)

Public tongues with interpretation — for the edification of the Church (1 Corinthians

14:5, 27-28)

3.3 Interpretation of Tongues

Interpretation of Tongues is the supernatural ability to interpret (make

understandable) a message given in tongues. It is not translation (word-for-word) but

interpretation (meaning-for-meaning). After a public message in tongues, the Spirit

gives another believer the interpretation so the Church may be edified.

Gifts Vs. Offices

It is important to distinguish between the manifest gifts of the Spirit (1 Corinthians

12:8-10) and the ministry offices (Ephesians 4:11).

 The Nine Gifts                                The Five-Fold Ministries
 Given to ALL believers                        Given to SOME believers
 For momentary manifestation                   For ongoing ministry function
 Operate as the Spirit wills                   Operate as a calling/office

The Five-Fold Ministries:
Apostle — Pioneer, church planter, father

Prophet — One who prophesies regularly and carries a prophetic office

Evangelist — Soul-winner, brings people to Christ

Pastor — Shepherd, cares for the flock

Teacher — Explains and grounds believers in the Word

You may operate in spiritual gifts without holding a five-fold office. Every believer

should desire and operate in the gifts; not every believer is called to a five-fold

office.

The Fruit of the Holy Spirit

The Fruit of the Holy Spirit is the visible expression of the Holy Spirit's nature developed

in the life of a born-again believer. It is not behavior modification; it is nature

transformation.

                                               Truth
 Misconception

 I must work hard to produce this fruit        The Spirit produces fruit as I abide

 I can pick which fruits to develop            It is ONE fruit with nine manifestations

 This is about external behavior               This is about internal nature
 I earn God's favor by bearing fruit              Fruit is evidence I already have His favor

Galatians 5:22-23 - But the fruit of the Spirit is love, joy, peace, forbearance, kindness,

goodness, faithfulness, 23 gentleness and self-control. Against such things there is no

law.

Why "Fruit" and Not "Fruits"?

Paul uses the singular "fruit", not "fruits." This teaches us: The Holy Spirit's work in us is

unified, not fragmented, all nine manifestations grow together, not in isolation,

meaning you cannot have love without joy, or peace without patience. With this in

mind, maturity means balanced development across all nine areas

The Nine Manifestations

   A.​ Love (Agape)

       Definition: Divine, unconditional love — the very nature of God (1 John 4:8).

       This is the Love that loves the unlovable, that gives without expecting return,

       and that seeks the highest good of others regardless of their response.

       It is not characterized by emotional affection, romantic feeling and is not

       based on the worthiness of the recipient

Key Scripture: "God commendeth his love toward us, in that, while we were yet

sinners, Christ died for us." — Romans 5:8
Reflection Questions:

   ●​ Who in your life is difficult to love? How can God's love flow through you

      toward them this week?

   ●​ In what areas have you been loving conditionally?

Practical Assignment: Identify one person you've struggled to love. Pray for them

daily this week. Speak blessing over them. Take one concrete action to show

kindness.

   B.​ Joy

      Definition: Deep, abiding gladness rooted in your relationship with God — not

      dependent on circumstances.

      It is characterized by the joy of salvation, the joy of knowing you're righteous

      and an expression of strength in the storm (Nehemiah 8:10)

      Joy is not happiness (which depends on happenings), neither is it denial of

      pain or struggle.

Key Scripture: "These things have I spoken unto you, that my joy might remain in you,

and that your joy might be full." — John 15:11

Reflection Questions:

   ●​ What circumstances typically rob you of joy?

   ●​ How can you anchor your joy in Christ rather than conditions?

Practical Assignment: For seven days, begin each morning by declaring three things

you're thankful for. End each day by recording one evidence of God's faithfulness.
   C.​ Peace

       Definition: Wholeness, completeness, nothing broken, nothing missing — the

       calm in the chaos.

       This is the Shalom present in God that entails total well-being, having Peace

       that passes understanding (Philippians 4:7) and a Confidence that God holds

       your life.

       Peace is not a mere absence of conflict, avoidance of difficult situations or

       emotional numbness, it is the assurance that regardless of what happens,

       God has the best of interest at heart towards you.

Key Scripture: "Peace I leave with you, my peace I give unto you: not as the world

giveth, give I unto you." — John 14:27

Reflection Questions:

   ●​ Where in your life do you feel unrest or anxiety?

   ●​ What would it look like to surrender that area to God's peace?

Practical Assignment: Identify your primary source of anxiety. Write it down. Over it,

write: "The peace of God guards my heart and mind in Christ Jesus." Read Philippians

4:6-7 aloud daily.

   D.​ Longsuffering (Patience)

       Definition: Patience with people — slow to anger, forbearing, willing to endure

       provocation.
       A Christian yielded to the Holy Spirit is long-tempered (not short-tempered),

       where God's patience reproduced in them, having endurance under

       provocation without retaliation.

       Noteworthy, longsuffering is not passive acceptance of abuse, suppression of

       righteous anger, weakness or inability to set boundaries.

Key Scripture: "The Lord is not slack concerning his promise... but is longsuffering to

us-ward." — 2 Peter 3:9

Reflection Questions:

   ●​ Who or what tests your patience most often?

   ●​ How does God's patience toward you inspire your patience toward others?

Practical Assignment: The next time you feel irritation rising, pause. Breathe. Pray

silently: "Holy Spirit, express Your patience through me." Respond only after you've

invited His presence.

   E.​ Gentleness

       Definition: Kindness in action — it is a tender disposition that treats others with

       care.

       Gentleness is essentially strength under control, where power is used to heal,

       not harm, putting into consideration the weak and vulnerable.

       Gentleness is not weakness or timidity, it is not being passive or avoiding hard

       conversations, but a sense of having your strength under control.

Key Scripture: "Let your moderation be known unto all men. The Lord is at hand." —

Philippians 4:5
Reflection Questions:

   ●​ In what situations do you tend to be harsh rather than gentle?

   ●​ How can you speak truth with gentleness?

Practical Assignment: Practice the "gentle response." When provoked, consciously

lower your voice. Choose words that heal. Notice the impact.

   F.​ Goodness

       Definition: Goodness is moral excellence in action — actively doing what is

       right, just, and beneficial.

       It is expressed through integrity both in private and public, where one is

       inclined to do good even when unseen. Goodness is not mere niceness,

       people-pleasing or expressing righteousness for show.

Key Scripture: "Let us not be weary in well doing: for in due season we shall reap, if

we faint not." — Galatians 6:9

Reflection Questions:

   ●​ Where are you tempted to compromise your integrity?

   ●​ What "good work" is God calling you to step into?

Practical Assignment: Perform one act of goodness this week that no one will know

about but God. Let it be your secret worship.
   G.​ Faithfulness

        Definition: Faithfulness is the expression of reliability, trustworthiness, and

        steadfastness. It is being a person of your word, expressing consistent

        character regardless of circumstances and upholding steadfast loyalty to

        God and others.

Key Scripture: "He that is faithful in that which is least is faithful also in much." — Luke

16:10

Reflection Questions:

   ●​ Where have you been unreliable — in small things or large?

   ●​ What commitment do you need to honor that you've neglected?

Practical Assignment: Identify one promise you've made (to God or someone else)

that you haven't fulfilled. Take concrete steps to honor it this week.

   H.​ Meekness

        Definition: Meekness can be considered as having your power under control

        — humility that doesn't insist on its own rights.

        It is having strength that serves rather than wanting to be served or dominate.

        It is expressed by being teachable and valuing other people more than

        yourself (Philippians 2:3) “Do nothing out of selfish ambition or vain conceit.

        Rather, in humility value others above yourselves,”

        Meekness is not weakness or cowardice, or a lack of conviction.

Key Scripture: "Blessed are the meek: for they shall inherit the earth." — Matthew 5:5
Reflection Questions:

   ●​ Where do you insist on your own way?

   ●​ What would surrender look like in that area?

Practical Assignment: This week, yield your "right to be right" in one situation. Listen

more than you speak. Observe what happens.

   I.​ Temperance

         Definition: It is the expression of Self-control — mastery over desires and

         impulses.

         A christian that has solid tem[prance has mastered regulation, the ability to

         say "no" to the flesh and to say "yes" to the Spirit, practicing discipline that is

         based on love and not fear.

Key Scripture: "Every man that striveth for the mastery is temperate in all things." — 1

Corinthians 9:25

Reflection Questions:

   ●​ What area of your life lacks self-control?

   ●​ What practical boundaries would help you walk in temperance?

Practical Assignment: Choose one area where you need self-control (food, screen

time, spending, speech). Set one clear, measurable boundary. Track your progress

daily.
Misconceptions about the Holy Spirit

  1.​ He is a force or a Power

  2.​ He is Disordary and chaotic

  3.​ People who have the Holy Spirit are not calm, He needs people to pray loudly

  4.​ He is limited to speaking in tongues only.$NB$, 'quiz', 26, 70, 'published')
ON CONFLICT (level_number, module_sequence_number) DO UPDATE SET
  title = EXCLUDED.title, lesson_content = EXCLUDED.lesson_content, evaluation_kind = EXCLUDED.evaluation_kind,
  estimated_minutes = EXCLUDED.estimated_minutes, quiz_pass_mark = EXCLUDED.quiz_pass_mark,
  status = 'published', updated_at = now();
DELETE FROM question_bank WHERE module_id = (SELECT module_id FROM modules WHERE level_number=1 AND module_sequence_number=7);
INSERT INTO question_bank (module_id, q_type, question_text, answer_options, correct_answer, difficulty_rating, is_active)
SELECT module_id, 'multiple_choice', $NQ$The module calls the Holy Spirit "The New Roommate." According to the text, why is this name used?$NQ$, $NA${"choices":[{"id":"opt-l1m7q1o1","text":"Because a roommate shares your space and is present in your everyday life","is_correct":true},{"id":"opt-l1m7q1o2","text":"Because a roommate only visits occasionally when invited","is_correct":false},{"id":"opt-l1m7q1o3","text":"Because a roommate is a force that comes and goes","is_correct":false},{"id":"opt-l1m7q1o4","text":"Because a roommate appears only during church services","is_correct":false}]}$NA$::jsonb, $NC$Because a roommate shares your space and is present in your everyday life$NC$, 1, TRUE
  FROM modules WHERE level_number=1 AND module_sequence_number=7;
INSERT INTO question_bank (module_id, q_type, question_text, answer_options, correct_answer, difficulty_rating, is_active)
SELECT module_id, 'multiple_choice', $NQ$The text describes who the Holy Spirit is in relation to the Trinity. How does it identify Him?$NQ$, $NA${"choices":[{"id":"opt-l1m7q2o1","text":"Fully God, the third person of the Trinity, co-equal with the Father and the Son","is_correct":true},{"id":"opt-l1m7q2o2","text":"A power and a feeling given by the Father","is_correct":false},{"id":"opt-l1m7q2o3","text":"An angel sent to appear to mankind","is_correct":false},{"id":"opt-l1m7q2o4","text":"A lesser spirit subordinate to the Father and the Son","is_correct":false}]}$NA$::jsonb, $NC$Fully God, the third person of the Trinity, co-equal with the Father and the Son$NC$, 1, TRUE
  FROM modules WHERE level_number=1 AND module_sequence_number=7;
INSERT INTO question_bank (module_id, q_type, question_text, answer_options, correct_answer, difficulty_rating, is_active)
SELECT module_id, 'multiple_choice', $NQ$The module lists personal traits of the Holy Spirit to show He has a personality. Which set of traits does it give?$NQ$, $NA${"choices":[{"id":"opt-l1m7q3o1","text":"He loves, He gets angry, and He gets heartbreaks and grief","is_correct":true},{"id":"opt-l1m7q3o2","text":"He is happy, calm, and never disturbed","is_correct":false},{"id":"opt-l1m7q3o3","text":"He is wise, powerful, and unfeeling","is_correct":false},{"id":"opt-l1m7q3o4","text":"He loves, He forgives, and He rejoices only","is_correct":false}]}$NA$::jsonb, $NC$He loves, He gets angry, and He gets heartbreaks and grief$NC$, 2, TRUE
  FROM modules WHERE level_number=1 AND module_sequence_number=7;
INSERT INTO question_bank (module_id, q_type, question_text, answer_options, correct_answer, difficulty_rating, is_active)
SELECT module_id, 'multiple_choice', $NQ$The text explains when the Holy Spirit takes up residence in a person, making them a living temple. When does this happen?$NQ$, $NA${"choices":[{"id":"opt-l1m7q4o1","text":"At the moment of the new birth","is_correct":true},{"id":"opt-l1m7q4o2","text":"After years of faithful church attendance","is_correct":false},{"id":"opt-l1m7q4o3","text":"Only when a believer first speaks in tongues","is_correct":false},{"id":"opt-l1m7q4o4","text":"When a believer earns it through human effort","is_correct":false}]}$NA$::jsonb, $NC$At the moment of the new birth$NC$, 2, TRUE
  FROM modules WHERE level_number=1 AND module_sequence_number=7;
INSERT INTO question_bank (module_id, q_type, question_text, answer_options, correct_answer, difficulty_rating, is_active)
SELECT module_id, 'multiple_choice', $NQ$The module distinguishes between the gifts and the fruit of the Holy Spirit. According to the text, what is true of the gifts versus the fruit?$NQ$, $NA${"choices":[{"id":"opt-l1m7q5o1","text":"Gifts are given as He wills to anyone He chooses, while fruits abide even when gifts are not visibly at work","is_correct":true},{"id":"opt-l1m7q5o2","text":"Fruits are given as He wills, while gifts abide permanently in every believer","is_correct":false},{"id":"opt-l1m7q5o3","text":"Both gifts and fruits are natural talents God may use","is_correct":false},{"id":"opt-l1m7q5o4","text":"Gifts are produced by hard work, while fruits are received by faith","is_correct":false}]}$NA$::jsonb, $NC$Gifts are given as He wills to anyone He chooses, while fruits abide even when gifts are not visibly at work$NC$, 3, TRUE
  FROM modules WHERE level_number=1 AND module_sequence_number=7;
INSERT INTO question_bank (module_id, q_type, question_text, answer_options, correct_answer, difficulty_rating, is_active)
SELECT module_id, 'multiple_choice', $NQ$The text says the ministry of the Holy Spirit is not to draw attention to Himself. What does it say He does instead?$NQ$, $NA${"choices":[{"id":"opt-l1m7q6o1","text":"He glorifies Jesus and points believers to Christ","is_correct":true},{"id":"opt-l1m7q6o2","text":"He glorifies Himself so believers will worship the Spirit","is_correct":false},{"id":"opt-l1m7q6o3","text":"He draws attention to the gifts He distributes","is_correct":false},{"id":"opt-l1m7q6o4","text":"He elevates the five-fold ministry offices","is_correct":false}]}$NA$::jsonb, $NC$He glorifies Jesus and points believers to Christ$NC$, 3, TRUE
  FROM modules WHERE level_number=1 AND module_sequence_number=7;
INSERT INTO question_bank (module_id, q_type, question_text, answer_options, correct_answer, difficulty_rating, is_active)
SELECT module_id, 'multiple_choice', $NQ$The module lists steps for how to receive the Holy Spirit. According to the text, what is the very first step?$NQ$, $NA${"choices":[{"id":"opt-l1m7q7o1","text":"Be born again, since the Holy Spirit is given to those who belong to Christ through faith","is_correct":true},{"id":"opt-l1m7q7o2","text":"Speak in other tongues as the Spirit gives utterance","is_correct":false},{"id":"opt-l1m7q7o3","text":"Work hard to earn the Spirit through obedience","is_correct":false},{"id":"opt-l1m7q7o4","text":"Yield yourself and allow Him to lead your life","is_correct":false}]}$NA$::jsonb, $NC$Be born again, since the Holy Spirit is given to those who belong to Christ through faith$NC$, 4, TRUE
  FROM modules WHERE level_number=1 AND module_sequence_number=7;
INSERT INTO question_bank (module_id, q_type, question_text, answer_options, correct_answer, difficulty_rating, is_active)
SELECT module_id, 'multiple_choice', $NQ$The text groups the nine gifts of the Spirit into three categories: Revelation, Power, and Inspiration. Which gift belongs to the Gifts of Power?$NQ$, $NA${"choices":[{"id":"opt-l1m7q8o1","text":"The Working of Miracles","is_correct":true},{"id":"opt-l1m7q8o2","text":"The Word of Knowledge","is_correct":false},{"id":"opt-l1m7q8o3","text":"Prophecy","is_correct":false},{"id":"opt-l1m7q8o4","text":"Interpretation of Tongues","is_correct":false}]}$NA$::jsonb, $NC$The Working of Miracles$NC$, 4, TRUE
  FROM modules WHERE level_number=1 AND module_sequence_number=7;
INSERT INTO question_bank (module_id, q_type, question_text, answer_options, correct_answer, difficulty_rating, is_active)
SELECT module_id, 'multiple_choice', $NQ$The module contrasts the nine gifts of the Spirit with the five-fold ministry offices. Which description matches the nine gifts rather than the offices?$NQ$, $NA${"choices":[{"id":"opt-l1m7q9o1","text":"Given to all believers, for momentary manifestation, operating as the Spirit wills","is_correct":true},{"id":"opt-l1m7q9o2","text":"Given to some believers, for ongoing ministry function, operating as a calling","is_correct":false},{"id":"opt-l1m7q9o3","text":"Given to some believers and earned through striving over time","is_correct":false},{"id":"opt-l1m7q9o4","text":"Given to all believers as a permanent office held for life","is_correct":false}]}$NA$::jsonb, $NC$Given to all believers, for momentary manifestation, operating as the Spirit wills$NC$, 5, TRUE
  FROM modules WHERE level_number=1 AND module_sequence_number=7;
INSERT INTO question_bank (module_id, q_type, question_text, answer_options, correct_answer, difficulty_rating, is_active)
SELECT module_id, 'multiple_choice', $NQ$The text explains why Paul uses the singular "fruit" and not "fruits." What does it say this teaches about the Spirit's work?$NQ$, $NA${"choices":[{"id":"opt-l1m7q10o1","text":"It is one unified work with nine manifestations that grow together, so maturity means balanced development across all nine","is_correct":true},{"id":"opt-l1m7q10o2","text":"It means a believer may pick which fruits to develop one at a time","is_correct":false},{"id":"opt-l1m7q10o3","text":"It means the fruit is about external behavior modification rather than nature","is_correct":false},{"id":"opt-l1m7q10o4","text":"It means each fruit is a separate gift distributed as the Spirit wills","is_correct":false}]}$NA$::jsonb, $NC$It is one unified work with nine manifestations that grow together, so maturity means balanced development across all nine$NC$, 5, TRUE
  FROM modules WHERE level_number=1 AND module_sequence_number=7;

-- ===== Level 1 · Module 8: Christian Living & Character (First Steps of Obedience) =====
-- Full teaching content supplied by the pastoral team (was outline-only). A read-and-
-- complete lesson ('none'); the body carries the section "Group Questions" inline.
INSERT INTO modules (level_number, module_sequence_number, title, summary, key_verses, lesson_content, evaluation_kind, estimated_minutes, quiz_pass_mark, status)
VALUES (1, 8, $NT$Christian Living & Character (First Steps of Obedience)$NT$,
  $NS$Living from who you already are in Christ — biblical lifestyle principles, Christlike character, integrity, purpose, and freedom from guilt and condemnation.$NS$,
  $NK$["2 Corinthians 5:17", "Romans 12:2", "Galatians 2:20", "Galatians 5:22-23", "Proverbs 11:3", "1 Peter 2:9", "Romans 8:1", "1 John 1:9"]$NK$::jsonb,
  $NB$*First Steps of Obedience*

Christian living is not about trying harder to be good; it is about living from the reality of who you already are in Christ. You are a new creation (2 Corinthians 5:17), and your character is simply the expression of Christ's life flowing through you. This module will equip you to walk in biblical lifestyle principles, develop Christlike character, maintain integrity, live purposefully, and walk free from guilt and condemnation.

## 1. Biblical Lifestyle Principles

### 1.1 What Is a Biblical Lifestyle?

A biblical lifestyle is one that aligns with God's Word in every area — thoughts, speech, relationships, work, finances, leisure, and worship. It is not a set of restrictions but a pathway to abundant living (John 10:10).

### 1.2 Foundational Principles

**a) The Word as Your Guide**

> "Your word is a lamp to my feet and a light to my path." — Psalm 119:105

A Christian must build a dependency on the Word of God — in other words, cultivate a Word culture. To do this, you have to:

- Make daily Bible reading and meditation non-negotiable.
- Allow Scripture to shape your decisions, rather than culture or emotions.
- Memorise key verses for moments of temptation and decision-making.

**b) Prayer as Communion, Not Just Communication**

When you receive Christ, you are called into constant fellowship with God, and one of the avenues for this fellowship is prayer. God calls us to cultivate a lifestyle of prayer; Scripture repeatedly emphasises the need to pray continually — that is, to make prayer habitual. The Word calls us to:

- Pray without ceasing (1 Thessalonians 5:17) — maintaining an ongoing conversation with God.
- Pray in tongues daily for self-edification (Jude 1:20; 1 Corinthians 14:4).
- Bring everything to God in prayer with thanksgiving (Philippians 4:6-7).

**c) Fellowship and Church Commitment**

In Module 6, we covered fellowship at length — a key aspect of the biblical lifestyle into which God has called His children. You must be committed to fellowship with other believers, which you can do by:

- Not forsaking the assembling of yourselves together with other believers (Hebrews 10:25).
- Serving in your local church — you are a member of the Body, not a spectator.
- Building genuine Christian friendships that sharpen and strengthen you (Proverbs 27:17).

**d) Stewardship**

There is so much that God has committed to your stewardship, and all of it must produce fruit for Him. This is why we will give an account for everything God has entrusted to us. Ask yourself: what has my life produced for God so far? At the most basic level, your life ought to manifest the fruits of righteousness, now that Christ lives in you.

> "Being filled with the fruits of righteousness, which are by Jesus Christ, unto the glory and praise of God." — Philippians 1:11 (NKJV)

Other areas in which we ought to exercise godly stewardship include:

- **Time.** Spend your time in a manner that honours God and bears fruit for Him. "Redeem the time, for the days are evil" (Ephesians 5:16).
- **Finances.** The financial blessings God gives are meant to enable us to serve Him and His people better. Honour God with your increase; give cheerfully and consistently (2 Corinthians 9:7).
- **The Body.** Your body is the temple of the Holy Spirit, so care for it (1 Corinthians 6:19-20). This places a demand on us not to expose our bodies to things that dishonour God — for example, a Christian should not watch adult-rated content or indulge in substance abuse, as these dishonour God and His temple.
- **Gifts and Talents.** God expects us to deploy our gifts for Kingdom impact, serving one another in love, meekness, and faithfulness.

**e) Separation from Worldly Patterns**

Being born again means being translated into a new Kingdom — the Kingdom of God — and so the world's principles and patterns become foreign to you. Worldly ways should no longer shape how a Christian operates.

> "Do not be conformed to this world, but be transformed by the renewing of your mind." — Romans 12:2

Therefore, we are called to:

- Be in the world, but not of it (John 17:14-16).
- Guard what you consume — media, entertainment, and music.
- Choose holiness over popularity.
- Use the Word as our benchmark for decision-making and the way we handle things.

### 1.3 Practical Application

| Area | Biblical Standard | Practical Step |
| --- | --- | --- |
| Speech | Ephesians 4:29 | Pause before speaking and ask: Is it true, kind, and necessary? |
| Entertainment | Philippians 4:8 | Audit what you watch — does it honour God? |
| Relationships | 2 Corinthians 6:14 | Pursue friendships that draw you closer to God. |
| Work | Colossians 3:23 | Work as unto the Lord, not unto men. |
| Finances | Malachi 3:10; Luke 6:38 | Tithe faithfully and give generously. |

## 2. Christlikeness

Christlikeness is not imitation; it is manifestation. Christ lives in you (Galatians 2:20), and your life expresses His character. You are not trying to become like Jesus — you are already like Him by new birth. Now you simply express it.

> "Therefore if any man be in Christ, he is a new creature: old things are passed away; behold, all things are become new." — 2 Corinthians 5:17 (KJV)

God's goal for you is not merely to make you religious, but to make you like His Son, Jesus. Christlikeness means your character begins to look like His — His love, His patience, His humility, His kindness. This happens little by little as you spend time with Him. You do not produce it by force; the Holy Spirit grows it in you, like fruit on a healthy branch.

> "For whom he did foreknow, he also did predestinate to be conformed to the image of his Son, that he might be the firstborn among many brethren." — Romans 8:29 (KJV)

> "But the fruit of the Spirit is love, joy, peace, longsuffering, gentleness, goodness, faith, meekness, temperance: against such there is no law." — Galatians 5:22-23 (KJV)

> "Have this mind among yourselves, which is yours in Christ Jesus, who, though he was in the form of God, did not count equality with God a thing to be grasped, but emptied himself, by taking the form of a servant, being born in the likeness of men." — Philippians 2:5-7

> "I am crucified with Christ: nevertheless I live; yet not I, but Christ liveth in me: and the life which I now live in the flesh I live by the faith of the Son of God, who loved me, and gave himself for me." — Galatians 2:20 (KJV)

**Remember This:** God is not just making me better. He is making me like Jesus.

**Illustration.** A branch does not strain to produce oranges. It stays connected to the tree, and the fruit comes naturally. Christian character works the same way: stay joined to Jesus, and His life produces the fruit in you. Trying to bear fruit while disconnected only leads to frustration. Jesus Himself said that He does what He sees His Father do:

> "Truly, truly, I say to you, the Son can do nothing of his own accord, but only what he sees the Father doing. For whatever the Father does, that the Son does likewise." — John 5:19-20

**Practical Ways of Cultivating Christlikeness**

- Spend time with Him — you become like what you behold (2 Corinthians 3:18).
- Obey promptly — obedience is the soil where character grows.
- Embrace trials — suffering produces perseverance and character (Romans 5:3-4).
- Yield to the Holy Spirit — He produces the fruit; you simply abide (Galatians 5:22-23).
- Confess and renounce — when you fall, agree with God quickly and move on (1 John 1:9).

**Key Truth:** I do not behave in order to become a new creation. I behave like a new creation because that is who I already am.

**Group Question:** What is one old thing you sense God has already begun to make new in you? How does it change things to know that you are accepted first, and then you obey — rather than obeying in order to be accepted?

## 3. Integrity

Integrity is wholeness — being the same person in private that you are in public. It is honesty, consistency, and moral uprightness, and it is the foundation of trust and influence.

> "The integrity of the upright will guide them." — Proverbs 11:3

> "If you have not handled the riches of this world with integrity, why should you be trusted with the eternal treasures of the spiritual world?" — Luke 16:11 (paraphrase)

Integrity means being the same person all the way through: who you are in private matches who you are in public. There is no hidden life that contradicts the visible one.

**Why Integrity Matters**

- **God values it:** the Lord delights in those who walk in integrity (Proverbs 11:20).
- **It protects you:** integrity guards your reputation and your future.
- **It amplifies your witness:** people trust and follow those of integrity.
- **It honours God:** your life becomes a testimony of His transforming power.

Integrity is built in the small choices, long before it is tested in the big ones — honesty and godly stewardship with a little money, faithfulness in a small job, truth in a small conversation. That is where character is made.

> "He that walketh uprightly walketh surely: but he that perverteth his ways shall be known." — Proverbs 10:9 (KJV)

> "He that is faithful in that which is least is faithful also in much: and he that is unjust in the least is unjust also in much." — Luke 16:10 (KJV)

**Remember:** Integrity is who I am when no one but God is looking.

**Areas in Which to Uphold Integrity**

**a) Honesty in Speech** — Let your yes be yes and your no be no (Matthew 5:37); no exaggeration, no half-truths, no deception; admit your mistakes quickly.

**b) Faithfulness in Commitments** — Keep your promises; show up on time and prepared; finish what you start.

**c) Financial Integrity** — Pay your debts; do not cheat, cut corners, or defraud; be transparent in business and ministry finances.

**d) Moral Purity** — Flee sexual immorality (1 Corinthians 6:18); guard your eyes and your heart; set boundaries before temptation comes.

**e) Confidentiality** — Do not gossip or betray confidences; be a safe person for others.

## 4. Living Purposefully

To live purposefully, you must first understand your true identity. Living purposefully means living on purpose, not by accident. A follower of Jesus does not merely drift through life; you live with direction, making daily choices that matter for eternity. God made you for good works that He prepared for you ahead of time, and part of living purposefully is letting go of the past so that it does not weigh down your future.

### True Identity

Your true identity is an identity that is not influenced or affected by the external factors of life — the factors that otherwise shape how we relate to others, how we handle situations, and how our personality forms. There is who we say we are, and there is who God says we are.

### Who God Says We Are

> "But you are a chosen people, a royal priesthood, a holy nation, God's special possession, that you may declare the praises of him who called you out of darkness into his wonderful light." — 1 Peter 2:9 (NIV)

Our purpose is attached to our true identity: "…that you may declare the praises of him who called you" (1 Peter 2:9).

> "For those who are led by the Spirit of God are the children of God." — Romans 8:14 (NIV)

So, according to God, we are: a chosen people; a royal priesthood; a holy nation; God's special possession; children of God. Living in the reality of what God says we are depends largely on our priesthood, so let us look more closely at the royal priesthood.

### Royal Priesthood

> "…and from Jesus Christ, who is the faithful witness, the firstborn from the dead, and the ruler of the kings of the earth. To him who loves us and has freed us from our sins by his blood, and has made us to be a kingdom and priests to serve his God and Father — to him be glory and power for ever and ever! Amen." — Revelation 1:5-6 (NIV)

This scripture reveals two things: kingship and priesthood.

**Kingship.** A kingdom or nation is ruled by a head of state, such as a monarch, president, or prime minister.

> "The heaven, even the heavens, are the LORD's: but the earth hath he given to the children of men." — Psalm 115:16 (KJV)

> "And God blessed them, and God said unto them, Be fruitful, and multiply, and replenish the earth, and subdue it: and have dominion…" — Genesis 1:28 (KJV)

Authority was given to us as rulers over the earth; therefore, we are to exercise kingship — and our kingship depends on our priesthood.

**Priesthood** represents direct access to God, the privilege of intercession, and the responsibility to offer spiritual sacrifices of praise and service.

> "The LORD has sworn and will not change his mind: 'You are a priest forever, in the order of Melchizedek.'" — Psalm 110:4 (NIV)

Your engagement in prayer and intercession is what brings about revelation, awakening, and a supply of grace:

- **Revelation** — that God "may give you the Spirit of wisdom and revelation, so that you may know him better." (Ephesians 1:16-17, NIV)
- **Awakening** — "that the eyes of your heart may be enlightened in order that you may know the hope to which he has called you…" (Ephesians 1:18, NIV)
- **Supply of Grace** — "…and his incomparably great power for us who believe." (Ephesians 1:19, NIV)

Prayer is not a choice; it is a mandate (Luke 18:1).

**Always Remember:** Your purpose is tied to your identity.

## 5. Purpose in God

Living purposefully answers the *how*; purpose in God answers the *why*. Your life is not an accident. God has good thoughts toward you, and He has a part for you to play in His plan. You do not have to do everything in order to be accepted — God loved us even before we knew He loved us.

> "For whom he did foreknow, he also did predestinate to be conformed to the image of his Son…" — Romans 8:29 (KJV)

Like David, you can serve your own generation by the will of God: know God, serve the people around you, and do His will in your day.

> "For I know the thoughts that I think toward you, saith the LORD, thoughts of peace, and not of evil, to give you an expected end." — Jeremiah 29:11 (KJV)

> "For David, after he had served his own generation by the will of God, fell on sleep, and was laid unto his fathers, and saw corruption." — Acts 13:36 (KJV)

God ordained you before birth (Jeremiah 1:5), but it will take your willingness (Isaiah 6:8) and your partnership with Him to bring His will into manifestation.

**Always Remember:** My life is not random. I was made on purpose, for a purpose, by a God who has good thoughts toward me.

## 6. Goodbye Guilt (Part 1)

*Silencing the echoes of your past to hear the music of your future.*

Many new believers carry guilt and shame from the past. The enemy replays your old failures like echoes that will not stop, trying to drown out the new song God is singing over you. Today, those echoes can be silenced. God gives you three gifts — forgiveness, cleansing, and assurance. Receive each one.

> "If we confess our sins, he is faithful and just to forgive us our sins, and to cleanse us from all unrighteousness." — 1 John 1:9 (KJV)

> "As far as the east is from the west, so far hath he removed our transgressions from us." — Psalm 103:12 (KJV)

> "There is therefore now no condemnation to them which are in Christ Jesus, who walk not after the flesh, but after the Spirit." — Romans 8:1 (KJV)

**Three Things God Gives You**

- **Forgiveness** — when you confess, He always forgives.
- **Cleansing** — He blots out your sin and chooses not to remember it.
- **Assurance** — in Christ, there is now no condemnation at all.

**Always Remember:** God has forgiven it, cleansed it, and forgotten it. I am not condemned. I am free.$NB$, 'none', 25, 70, 'published')
ON CONFLICT (level_number, module_sequence_number) DO UPDATE SET
  title = EXCLUDED.title, summary = EXCLUDED.summary, key_verses = EXCLUDED.key_verses,
  lesson_content = EXCLUDED.lesson_content, evaluation_kind = EXCLUDED.evaluation_kind,
  estimated_minutes = EXCLUDED.estimated_minutes, quiz_pass_mark = EXCLUDED.quiz_pass_mark,
  status = 'published', updated_at = now();
DELETE FROM question_bank WHERE module_id = (SELECT module_id FROM modules WHERE level_number=1 AND module_sequence_number=8);

-- ===== Level 1 · Module 9: Relationships & Community (Belonging) =====
INSERT INTO modules (level_number, module_sequence_number, title, lesson_content, evaluation_kind, estimated_minutes, quiz_pass_mark, status)
VALUES (1, 9, $NT$Relationships & Community (Belonging)$NT$, $NB$●​ Relationship with God

  ●​ Relationship with Self

  ●​ Relationship with Others

  ●​ The Family Table (Part 1): Why Church Matters (community, doctrine,

     covering, sacraments, growth)$NB$, 'none', 8, 70, 'published')
ON CONFLICT (level_number, module_sequence_number) DO UPDATE SET
  title = EXCLUDED.title, lesson_content = EXCLUDED.lesson_content, evaluation_kind = EXCLUDED.evaluation_kind,
  estimated_minutes = EXCLUDED.estimated_minutes, quiz_pass_mark = EXCLUDED.quiz_pass_mark,
  status = 'published', updated_at = now();
DELETE FROM question_bank WHERE module_id = (SELECT module_id FROM modules WHERE level_number=1 AND module_sequence_number=9);

-- ===== Level 1 · Module 10: Practical Life Questions (Early Clarity + The Battle) =====
INSERT INTO modules (level_number, module_sequence_number, title, lesson_content, evaluation_kind, estimated_minutes, quiz_pass_mark, status)
VALUES (1, 10, $NT$Practical Life Questions (Early Clarity + The Battle)$NT$, $NB$●​ Why Bad Things Happen to Good People

  ●​ Betting and Christianity

  ●​ Baptism (Water Baptism Included)

  ●​ Why Is It Suddenly Hard? (Part 1): The Battle (resistance after salvation,

     temptation, endurance, basic warfare)

  ●​ Your New Mission (Part 1): (becoming a channel for the same grace that

     rescued you — witness, service, first steps of discipleship)

  LEVEL 2: INNER TRANSFORMATION &

     KINGDOM LIVING (Part 2 —

     Formation)$NB$, 'none', 8, 70, 'published')
ON CONFLICT (level_number, module_sequence_number) DO UPDATE SET
  title = EXCLUDED.title, lesson_content = EXCLUDED.lesson_content, evaluation_kind = EXCLUDED.evaluation_kind,
  estimated_minutes = EXCLUDED.estimated_minutes, quiz_pass_mark = EXCLUDED.quiz_pass_mark,
  status = 'published', updated_at = now();
DELETE FROM question_bank WHERE module_id = (SELECT module_id FROM modules WHERE level_number=1 AND module_sequence_number=10);

-- Place the Level 1 exit exam after the 10 modules.
UPDATE modules SET module_sequence_number = 11 WHERE level_number = 1 AND evaluation_kind = 'exit_exam';

COMMIT;
