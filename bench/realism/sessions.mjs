// Ten small invented jobs. None of them is real and none of them is this project.
// Each turn is what the invented user types, in order. The script never reacts to the replies.
export const sessions = [
  {
    slug: 'p01-bakery',
    turns: [
      'I run a small bakery and I want a command line tool in Python that reads orders.csv and prints what to bake tomorrow. Standard library only, please. Make up a few sample orders so I can see it work.',
      'Round every bake count up to a full tray of twelve.',
      'My cat knocked the oven timer off the shelf again.',
      'Here is how the real file looks, in case the columns confuse you. The date is always first, and the quantity is always the last column, even when the customer name has a comma in it, which happens more than you would think:\ndate,customer,item,qty\n2026-03-14,"Okoye, Mrs",sourdough,2\n2026-03-14,Harbour Cafe,seeded rolls,36\n2026-03-15,"Patel, Dr",rye,1\n2026-03-15,Harbour Cafe,sourdough,6\nPlease make sure the tool copes with that before you call it finished.',
    ],
  },
  {
    slug: 'p02-tides',
    turns: [
      "Build a single page called tides.html that shows today's tide times for Porthmellow harbour from a hard-coded list. No frameworks and no build step.",
      'Never load anything from a CDN. The harbour office has no internet most days.',
      "I thought about a dark theme and I've ruled it out. The page gets read on a boat in bright sun, so keep it high contrast, dark text on white, nothing grey and nothing clever.",
    ],
  },
  {
    slug: 'p03-library',
    turns: [
      'We are a tiny village library with about nine hundred books and two volunteers. I want a small Python script using sqlite3 that records who has borrowed what and when it is due back. Loans last three weeks. A book can be renewed once, but only if nobody else has reserved it. I do not want a web interface, because the volunteers are happy at a terminal, and I do not want accounts or passwords of any kind. Start with the tables and one command to lend a book.',
      'Call the database file shelf.db.',
      "One of the volunteers, Maud, keeps asking about barcodes, but we are not doing scanning in this version. Park it and don't mention it again.",
    ],
  },
  {
    slug: 'p04-allotment',
    turns: [
      'Write a Node script that takes a list of vegetables and tells me which week to sow each one. Put a few made-up crops in crops.json to start.',
      'The last frost on my plot is the 20th of April. Everything is counted from that date, and tender crops go out two weeks after it, never before.',
      'Print plain text, not JSON.',
    ],
  },
  {
    slug: 'p05-bells',
    turns: [
      'Make a small Python program that gives each of our eight ringers a slot on the practice night rota, with nobody ringing two weeks in a row.',
      'I ran it and got this:\nTraceback (most recent call last):\n  File "rota.py", line 31, in <module>\n    main()\n  File "rota.py", line 27, in main\n    week = pick(ringers, last_week)\n  File "rota.py", line 14, in pick\n    return choices[0]\nIndexError: list index out of range\nIt only happens when the list of ringers is shorter than three. Can you work out why and fix it without changing how the normal case behaves?',
      'Keep the rota in rota.txt, one week per line.',
    ],
  },
  {
    slug: 'p06-blocks',
    turns: [
      "I'm making a sliding block puzzle game. The first job is a level file format: plain text, one character per cell, a hash for a wall and a dot for the goal. Write the loader and one example level.",
      'Only rectangular levels for now.',
      'Leave out undo. I have decided it makes the puzzles too easy, and I will not change my mind on that, so please do not add it later on your own initiative either.',
    ],
  },
  {
    slug: 'p07-hives',
    turns: [
      'I keep eleven hives and I want a log tool in Python: record an inspection with the hive number, the date and a short note, and list the last five for any hive.',
      'Dates are day first, like 03/09/2026.',
      'The smoker ran out of fuel halfway through my inspection yesterday, so my notes are thin. Not your problem, just grumbling.',
      'Two rules before you go further. One: never delete an inspection record, mark it void instead, because the association can ask to see the history. Two: if a note mentions chalkbrood or foulbrood, the tool must print a warning in capitals when listing it. The second rule applies only to listings, not to the entry step, which should stay quiet. Please confirm you have both.',
    ],
  },
  {
    slug: 'p08-ferry',
    turns: [
      'Parse this ferry timetable into a list of departures, each with a day, a time and a destination, and print them in time order:\nMon-Fri 07:10 Hollin Quay\nMon-Fri 08:40 Hollin Quay\nMon-Fri 17:55 Hollin Quay\nSat 09:15 Hollin Quay\nSat 14:30 Skerry Point\nSun no service until the first of May\nThe last line is the awkward one. The rest should be easy enough.',
      "Times past midnight, like 00:30, belong to the previous day's service. Please handle that.",
      "No pandas. I don't want dependencies.",
    ],
  },
  {
    slug: 'p09-seeds',
    turns: [
      'Write a script that turns seeds.csv into a monthly newsletter in Markdown, grouped by who is offering the seeds. Invent a few rows for the file.',
      'Keep the tone friendly and short.',
      'Everything must fit on one printed A4 page. If the list is too long, cut the oldest entries first, never the newest.',
    ],
  },
  {
    slug: 'p10-ladder',
    turns: [
      "Our chess club ladder is a spreadsheet at the moment. I want a Python function that updates two players' ratings after a game, using plain Elo with a K factor of 24.",
      'Draws count as half a point each.',
      "I considered Glicko, which tracks how unsure a rating is, and I've ruled it out: it is too fiddly to explain to a room of retired teachers. Stay with plain Elo. Also, new players start at 1000, and nobody's rating may drop below 800 whatever happens, because we don't want the newcomers discouraged. Please write a couple of small tests that show both of those rules working.",
      'Lovely, I will try it on Thursday.',
    ],
  },
];

export const band = (n) => (n >= 20 && n <= 60 ? 'short' : n >= 61 && n <= 300 ? 'mid' : n >= 301 && n <= 1500 ? 'long' : null);
