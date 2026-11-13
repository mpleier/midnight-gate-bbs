'use strict';
// Hand-written corpus so the board feels inhabited even with no LLM running.

const CHAT = [
  'anyone else getting a busy signal all night or is it just me',
  'just spent 40 minutes downloading a 300k file and it was corrupt. love this hobby',
  'who else is running a 14.4? my 2400 finally died and the replacement is night and day',
  'the ANSI on this board is ridiculous. whoever did the main menu, respect',
  'sysop, the door games are eating my time bank again',
  'anybody got a good source for door game registrations? I want to actually pay for LORD',
  'I swear the phone line noise gets worse when it rains',
  'reminder that you can turn off the status line with Y then A if the colours bother you',
  'my mom picked up the phone mid ZMODEM. 90 minutes gone',
  'back after a week offline, the modem got fried by a storm',
  'does anyone actually read the bulletins or am I the only one',
  'the trading game on this board is rigged and I have the spreadsheet to prove it',
  'first BBS I ever called was a single node running on an XT in some guy\'s basement',
  'has anyone tried one of those 28.8 models yet? sounds like magic',
  'I keep a notebook of board numbers. it is getting out of hand',
  'shout out to whoever uploaded the textfiles pack, that is a weekend gone',
  'the trick to the blackjack door is to walk away at 200 credits. I never do',
  'anyone want to trade ANSI packs? I have a few from 92/93',
  'my cat keeps sleeping on the keyboard and hanging up on people',
  'this is the only board where the chat actually has people in it at 2am',
  'serious question: is FidoNet mail worth the hassle for a 4 node board',
  'I got my handle from a comic book and I refuse to change it',
  'who keeps leaving one-liners about my mom. it is not 1989',
  'finally hit level 9 in the dragon game. only took three weeks of turns',
  'the sysop never sleeps, I swear. replies at 4am every time',
];

const POSTS = [
  {
    subject: 'modem recommendations?',
    body: 'My old 2400 is starting to drop carrier every twenty minutes or so.\nLooking at a 14.4 external. Anyone have experience with the Zoom models?\nIs the error correction actually worth it or is it marketing?',
  },
  {
    subject: 'ANSI art packs',
    body: 'I have been collecting art packs since 91 and I am finally organizing them.\nDoes anyone have the Acid Productions releases from early 93? I am missing a few.\nWill trade, obviously. No warez, just art.',
  },
  {
    subject: 'door game suggestions',
    body: 'Running a 4 node board and I want to add a couple more doors that work well\nfor people who only call once a day. Turn based is fine. Anything that does not\nneed a sysop babysitting it?',
  },
  {
    subject: 'the state of the scene',
    body: 'Reading the boards lately, half the posts are about the internet taking over.\nI do not buy it. People like calling a board, seeing who is on, leaving a message.\nYou cannot do that on a web page. Anyway, end of old man rant.',
  },
  {
    subject: 'ZMODEM vs YMODEM',
    body: 'Switched the board over to ZMODEM last week and the difference is real.\nResume on a dropped call saved me twice already. If you are still on XMODEM,\nmake the jump. Your callers will thank you.',
  },
  {
    subject: 'best textfiles from the archive',
    body: 'Went through the textfiles archive this weekend. The 80s phreaking docs are\nwild, but the real gem is the collection of sysop rants. Some things never change.\nAnyone have a favorite?',
  },
  {
    subject: 'node count question',
    body: 'Thinking about adding a second line. The busy signal at 8pm is embarrassing.\nFor those of you with multiple nodes: did your call volume actually go up, or\ndid you just split the same traffic?',
  },
  {
    subject: 'new here',
    body: 'Just got my first account. Board looks great, the art especially.\nWhat is worth playing first? I have about an hour a night after homework.',
  },
  {
    subject: 'keyboard recommendation',
    body: 'Looking for a mechanical keyboard that can take a beating. Typing 200 messages\na week on this membrane thing is destroying my wrists. Not picky about brands.',
  },
  {
    subject: 'sysop question about backups',
    body: 'What is everyone using to back up their message bases? I have been copying\nthe whole directory to floppies but it is getting silly. Tape drives are too\nexpensive for a hobby board.',
  },
  {
    subject: 'that blackjack door',
    body: 'Lost 400 credits in twenty minutes. Then won 900 back. Then lost 1200.\nI think the dealer is cheating but I cannot prove it and honestly I deserve it.',
  },
  {
    subject: 'ANSI editor tips',
    body: 'Trying to draw my own menus and everything looks like it was done with a ruler.\nAny tips on shading with the block characters? The gradient thing everyone does\nwith the logo, how is that even done by hand?',
  },
  {
    subject: 'trade wars alliance?',
    body: 'Starting a small alliance for the trading game. No fleet, no drama, just people\nwho want to move cargo without getting shot at in sector 14. Reply here if interested.',
  },
  {
    subject: 'phone line noise',
    body: 'Anyone else notice the line quality drops around 6pm? I keep getting retrains\nand one dropped carrier a night. The phone company says nothing is wrong, which\nmeans something is wrong.',
  },
];

const REPLIES = [
  'Same here. Mine drops every time the fridge kicks on.',
  'Have you tried a different phone cord? Sounds dumb but it fixed mine.',
  'This is the most 1994 question I have read all week and I love it.',
  'I would help but I am still figuring out the basics myself.',
  'Good point. I had not thought about it that way.',
  'Adding this to my notes. Thanks for typing it out.',
  'Strong disagree, but you argued it well.',
  'The sysop should pin this one.',
  'I have the same setup and zero problems. Check your serial cable.',
  'Finally, a thread worth reading.',
  'You are not wrong. You are not right either, but you are not wrong.',
  'Been waiting for someone to bring this up.',
];

const ONELINERS = [
  'a modem without a busy signal is just a phone',
  'the best part of the BBS is the part you cannot download',
  'if the art is not ANSI, is it even a board',
  'I measure my friendships in callbacks',
  'never trust a sysop with one node',
  'the internet will never replace a good busy signal',
  'typing is thinking out loud',
  'still running 2400 and proud',
  'my time bank is emptier than my wallet',
  'every board is somebody basement and that is the point',
  'NO CARRIER is the loneliest string in computing',
  'I came for the files and stayed for the arguments',
];

const ACTIVITIES = [
  'Reading messages',
  'Downloading files',
  'Playing door games',
  'Reading the bulletins',
  'In the chat room',
  'Filling out a questionnaire',
  'Looking at the user list',
  'Uploading a textfile',
  'Checking the new files scan',
];

const MAIL_INTROS = [
  'Saw your post on the message base. Welcome aboard. If you need anything, page the sysop and then yell at me instead.',
  'New handle, huh. The dragon game is where the real time sink is. Ask me how I know.',
  'Welcome. Rule one: do not upload anything you did not write or have permission to share. Rule two: have fun.',
  'You picked a good board. It is small but people actually reply here.',
  'Welcome to the Gate. Try the trade game, the turns reset at midnight.',
];

module.exports = { CHAT, POSTS, REPLIES, ONELINERS, ACTIVITIES, MAIL_INTROS };
