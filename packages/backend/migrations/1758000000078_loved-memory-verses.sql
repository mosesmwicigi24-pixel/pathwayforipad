-- Seed the "50 Most-Loved Verses" into the Memory Verses library (memory_verses),
-- the table the mobile Memory Verses screen + Content Studio › Memory Verses read.
-- Library verses (week_number NULL), active, sorted 101–150 so they group together
-- after any existing entries. References/translations/text transcribed verbatim
-- from the supplied PDF. Idempotent-ish: re-running is avoided by node-pg-migrate's
-- one-time application; the Down removes exactly this seeded block (sort 101–150).

-- Up Migration

INSERT INTO memory_verses (reference, verse_text, version, week_number, sort, is_active) VALUES
('John 3:16', 'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.', 'KJV', NULL, 101, TRUE),
('Jeremiah 29:11', 'For I know the plans I have for you, declares the LORD, plans to prosper you and not to harm you, plans to give you hope and a future.', 'NIV', NULL, 102, TRUE),
('Philippians 4:13', 'I can do all this through him who gives me strength.', 'NIV', NULL, 103, TRUE),
('Proverbs 3:5-6', 'Trust in the LORD with all your heart and lean not on your own understanding; in all your ways submit to him, and he will make your paths straight.', 'NIV', NULL, 104, TRUE),
('Romans 8:28', 'And we know that in all things God works for the good of those who love him, who have been called according to his purpose.', 'NIV', NULL, 105, TRUE),
('Psalm 23:1-3', 'The LORD is my shepherd; I shall not want. He maketh me to lie down in green pastures: he leadeth me beside the still waters. He restoreth my soul.', 'KJV', NULL, 106, TRUE),
('Isaiah 41:10', 'So do not fear, for I am with you; do not be dismayed, for I am your God. I will strengthen you and help you; I will uphold you with my righteous right hand.', 'NIV', NULL, 107, TRUE),
('Philippians 4:6-7', 'Do not be anxious about anything, but in every situation, by prayer and petition, with thanksgiving, present your requests to God. And the peace of God, which transcends all understanding, will guard your hearts and your minds in Christ Jesus.', 'NIV', NULL, 108, TRUE),
('Joshua 1:9', 'Be strong and courageous. Do not be afraid; do not be discouraged, for the LORD your God will be with you wherever you go.', 'NIV', NULL, 109, TRUE),
('Romans 12:2', 'Do not conform to the pattern of this world, but be transformed by the renewing of your mind.', 'NIV', NULL, 110, TRUE),
('John 14:6', 'Jesus said to him, I am the way, and the truth, and the life. No one comes to the Father except through me.', 'ESV', NULL, 111, TRUE),
('Matthew 6:33', 'But seek ye first the kingdom of God, and his righteousness; and all these things shall be added unto you.', 'KJV', NULL, 112, TRUE),
('Psalm 46:10', 'Be still, and know that I am God; I will be exalted among the nations, I will be exalted in the earth.', 'NIV', NULL, 113, TRUE),
('1 Corinthians 13:4-7', 'Love is patient, love is kind. It does not envy, it does not boast, it is not proud. It does not dishonor others, it is not self-seeking, it is not easily angered, it keeps no record of wrongs. Love does not delight in evil but rejoices with the truth. It always protects, always trusts, always hopes, always perseveres.', 'NIV', NULL, 114, TRUE),
('Galatians 5:22-23', 'But the fruit of the Spirit is love, joy, peace, forbearance, kindness, goodness, faithfulness, gentleness and self-control. Against such things there is no law.', 'NIV', NULL, 115, TRUE),
('Ephesians 2:8-9', 'For by grace you have been saved through faith. And this is not your own doing; it is the gift of God, not a result of works, so that no one may boast.', 'ESV', NULL, 116, TRUE),
('Romans 5:8', 'But God demonstrates his own love for us in this: While we were still sinners, Christ died for us.', 'NIV', NULL, 117, TRUE),
('John 1:1', 'In the beginning was the Word, and the Word was with God, and the Word was God.', 'KJV', NULL, 118, TRUE),
('Genesis 1:1', 'In the beginning God created the heaven and the earth.', 'KJV', NULL, 119, TRUE),
('Psalm 119:105', 'Thy word is a lamp unto my feet, and a light unto my path.', 'KJV', NULL, 120, TRUE),
('Isaiah 40:31', 'But they that wait upon the LORD shall renew their strength; they shall mount up with wings as eagles; they shall run, and not be weary; and they shall walk, and not faint.', 'KJV', NULL, 121, TRUE),
('Matthew 11:28', 'Come unto me, all ye that labour and are heavy laden, and I will give you rest.', 'KJV', NULL, 122, TRUE),
('2 Corinthians 5:17', 'Therefore, if anyone is in Christ, the new creation has come: The old has gone, the new is here!', 'NIV', NULL, 123, TRUE),
('Romans 10:9', 'If you declare with your mouth, Jesus is Lord, and believe in your heart that God raised him from the dead, you will be saved.', 'NIV', NULL, 124, TRUE),
('John 16:33', 'I have told you these things, so that in me you may have peace. In this world you will have trouble. But take heart! I have overcome the world.', 'NIV', NULL, 125, TRUE),
('Hebrews 11:1', 'Now faith is confidence in what we hope for and assurance about what we do not see.', 'NIV', NULL, 126, TRUE),
('Psalm 27:1', 'The LORD is my light and my salvation, whom shall I fear? The LORD is the stronghold of my life, of whom shall I be afraid?', 'NIV', NULL, 127, TRUE),
('Matthew 28:19-20', 'Therefore go and make disciples of all nations, baptizing them in the name of the Father and of the Son and of the Holy Spirit, and teaching them to obey everything I have commanded you. And surely I am with you always, to the very end of the age.', 'NIV', NULL, 128, TRUE),
('Romans 6:23', 'For the wages of sin is death, but the free gift of God is eternal life in Christ Jesus our Lord.', 'ESV', NULL, 129, TRUE),
('1 John 1:9', 'If we confess our sins, he is faithful and just and will forgive us our sins and purify us from all unrighteousness.', 'NIV', NULL, 130, TRUE),
('Lamentations 3:22-23', 'The steadfast love of the LORD never ceases; his mercies never come to an end; they are new every morning; great is your faithfulness.', 'ESV', NULL, 131, TRUE),
('Psalm 91:1-2', 'Whoever dwells in the shelter of the Most High will rest in the shadow of the Almighty. I will say of the LORD, He is my refuge and my fortress, my God, in whom I trust.', 'NIV', NULL, 132, TRUE),
('Romans 8:38-39', 'For I am convinced that neither death nor life, neither angels nor demons, neither the present nor the future, nor any powers, neither height nor depth, nor anything else in all creation, will be able to separate us from the love of God that is in Christ Jesus our Lord.', 'NIV', NULL, 133, TRUE),
('Philippians 4:19', 'And my God will meet all your needs according to the riches of his glory in Christ Jesus.', 'NIV', NULL, 134, TRUE),
('Proverbs 22:6', 'Start children off on the way they should go, and even when they are old they will not turn from it.', 'NIV', NULL, 135, TRUE),
('Micah 6:8', 'He has shown you, O mortal, what is good. And what does the LORD require of you? To act justly and to love mercy and to walk humbly with your God.', 'NIV', NULL, 136, TRUE),
('Matthew 5:16', 'Let your light shine before others, that they may see your good deeds and glorify your Father in heaven.', 'NIV', NULL, 137, TRUE),
('John 13:34-35', 'A new command I give you: Love one another. As I have loved you, so you must love one another. By this everyone will know that you are my disciples, if you love one another.', 'NIV', NULL, 138, TRUE),
('Psalm 121:1-2', 'I will lift up mine eyes unto the hills, from whence cometh my help. My help cometh from the LORD, which made heaven and earth.', 'KJV', NULL, 139, TRUE),
('2 Timothy 1:7', 'For God hath not given us the spirit of fear; but of power, and of love, and of a sound mind.', 'KJV', NULL, 140, TRUE),
('Isaiah 53:5', 'But he was pierced for our transgressions, he was crushed for our iniquities; the punishment that brought us peace was on him, and by his wounds we are healed.', 'NIV', NULL, 141, TRUE),
('Ephesians 6:10-11', 'Finally, be strong in the Lord and in his mighty power. Put on the full armor of God, so that you can take your stand against the devil''s schemes.', 'NIV', NULL, 142, TRUE),
('Psalm 37:4', 'Take delight in the LORD, and he will give you the desires of your heart.', 'NIV', NULL, 143, TRUE),
('Colossians 3:23', 'Whatever you do, work at it with all your heart, as working for the Lord, not for human masters.', 'NIV', NULL, 144, TRUE),
('1 Peter 5:7', 'Cast all your anxiety on him because he cares for you.', 'NIV', NULL, 145, TRUE),
('Joshua 24:15', 'And if it seem evil unto you to serve the LORD, choose you this day whom ye will serve; ... but as for me and my house, we will serve the LORD.', 'KJV', NULL, 146, TRUE),
('Deuteronomy 31:6', 'Be strong and courageous. Do not be afraid or terrified because of them, for the LORD your God goes with you; he will never leave you nor forsake you.', 'NIV', NULL, 147, TRUE),
('Matthew 7:7', 'Ask and it will be given to you; seek and you will find; knock and the door will be opened to you.', 'NIV', NULL, 148, TRUE),
('Revelation 3:20', 'Here I am! I stand at the door and knock. If anyone hears my voice and opens the door, I will come in and eat with that person, and they with me.', 'NIV', NULL, 149, TRUE),
('Psalm 139:14', 'I praise you because I am fearfully and wonderfully made; your works are wonderful, I know that full well.', 'NIV', NULL, 150, TRUE);

-- Down Migration

DELETE FROM memory_verses WHERE sort BETWEEN 101 AND 150;
