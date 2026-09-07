# Running the attendance kiosk

For whoever is at the front desk. You do not need to know anything about how
it works — this is the whole job, front to back.

Everything is stored **on this one device**. Nothing goes to a server, and
nothing is backed up anywhere. The Excel file you export at the end is the
real record. Export it every time.

## Starting the day

1. Open the scanner screen. You should see a big number, the word
   **checked in** under it, and a green dot saying **Scanner active**.
2. Leave the card reader plugged in and do not click into anything else on the
   screen. The reader types into the page, so the page has to be listening.
3. Check the dot in the top right before the first student:
   - **Scanner active** — good, taps are being read.
   - **Scanner paused — tap to resume** — touch or click anywhere on the
     background and it goes back to active.
   - **Scanner off — finish enrolling / close this dialog** — something is
     open on screen. Save it or cancel it first; nothing is being read until
     you do.
4. If the screen says **Nobody is enrolled on this device yet**, do the next
   section before anyone queues up.

## Enrolling a student (first time only)

A card only counts once it has been linked to a student. A brand new card
tapped at check-in is saved, but it is not attached to anybody yet.

1. Press **Enroll** at the top of the screen.
2. Tap the student's card. A short form opens.
3. Type the first name, last name and graduation year. The school email fills
   itself in — leave it alone unless it is wrong.
   - If the address is already taken, a box appears naming the student who has
     it. Pick the suggested alternative, or type a different
     `@stjohnschs.org` address.
4. Press **Save enrollment**.
5. **Press Check-in again.** The screen tells you to. If you stay on Enroll,
   the next card that taps opens another form instead of checking anyone in.

You only do this once per student, ever. The card stays theirs.

## Ordinary check-in

Press **Check-in**, and let students tap. Each tap gives you one line:

| What the screen says | What it means | What to do |
|---|---|---|
| **Check-in recorded** + name + time | Counted. The number went up by one. | Next student. |
| **… already checked in** — *"Already counted at 4:05 PM — no need to tap again"* | They tapped twice. They are counted once. | Nothing. Wave them on. |
| **Unknown card ••••E5F6 — tap saved** | The card works but nobody has enrolled it. The tap is saved, not lost. | Press **Enroll**, tap the same card, add the student, press **Check-in**, then have them tap once more so today's count is right. |
| **Bad read — tap again** | The reader only caught part of the card. | Have them tap again, held flat on the reader for a second. |
| **Card not recorded** | The device is not saving anything. | See *If something looks wrong* below. Stop and fix it — taps are being lost. |

The big number is how many **different** students have checked in this
session. Second taps never raise it.

## Ending a session and exporting

1. Press **End Session**, bottom right. This is safe: it only shows you the
   totals. Nothing is deleted, and **Back to scanning** returns you to the
   count exactly as it was.
2. Read the four numbers: unique attendance, total taps, duplicate taps,
   unknown cards.
3. Press **Export this session**. A message appears naming the file, something
   like `attendance-2026-09-06-20260907T0359Z.xlsx`.
   - On a laptop it goes to that computer's **Downloads** folder. The message
     says to go and check — please actually check, because if the download was
     blocked nothing tells the app.
   - On the tablet app it should say it saved to the device's **Documents**
     and open a share sheet — send it to yourself or to Drive from there. If
     it instead says the file was handed to the browser, stop and report it:
     the tablet build has not been tested on a real device yet, and that
     wording means the export did not go where it should.
4. **Email or upload the file the same day.** It is the only copy that leaves
   the device.
5. If another meeting follows, press **Start New Session** and confirm. That
   starts a fresh count. Nothing is erased — the old taps stay on the device
   and still appear in the dashboard's export.

To get everything ever recorded, not just today: **Dashboard** →
**Export all history**.

## The other two screens

- **Students** — everyone enrolled on this device. Search by name, email or
  the last four characters of a card. You can fix a name, class year or email.
  The card itself cannot be changed.
- **Dashboard** — attendance for the school year, and a count of cards that
  still belong to nobody.

  Each row also has a **Remove** button. It deletes the student *and every tap
  they have ever made on this device*, cannot be undone, and changes the
  numbers on the Dashboard. Only use it if a student has to be erased — export
  the day's file first, and read what the confirmation box tells you before
  pressing it.

Both of them say, in a grey bar at the top: *"Cards are not being recorded
while this page is open."* That is true. **Go back to the scanner before the
next student taps** — there is a link in that bar.

## If something looks wrong

**A red box: "This device isn't letting the app save."**
Nothing is being recorded. Take names on paper until it is fixed. Press
**Retry**. If it stays red: the browser is probably in a private window, or
site data is blocked, or the disk is full. Close the private window and open
the kiosk normally, then get someone technical. Do **not** clear the browser
or the app's data — that is where the attendance lives.

**A card will not read at all.**
Try a second card you know works. If that one reads, the card is the problem,
not the kiosk: write the student's name on paper and give it to whoever keeps
the roster. Do not check them in on somebody else's card. If no card reads at
all, check the reader's cable, then check that the dot in the top right says
**Scanner active** — if it says paused, click the background once.

**The count looks too low.**
- Were the first few taps done on the **Students** or **Dashboard** screen?
  Those do not record. The taps are gone; add those students from paper.
- Was the station left on **Enroll**? Those taps opened forms and recorded
  nothing.
- Are those students actually enrolled? An unknown card is saved, but it does
  not raise today's count until the card is enrolled and the student taps
  again.
- Remember the number counts people, not taps. Two taps from one student is
  still one.

**Someone pressed End Session by mistake.** Nothing happened. Press
**Back to scanning**.

**The tablet or laptop restarted.** The count for the session survives — it is
on the device. Open the kiosk again and carry on.

**Never** clear the browser's site data, use a private window, or uninstall
the app before the day's file has been exported and sent.
