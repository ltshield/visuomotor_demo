# Professor quick-start

**What it is.** A 5–10 minute browser activity. Students make quick mouse reaches from a center ring to a target and hold the dot there for a moment. Partway through, without any announcement, the dot's motion is rotated 45° relative to the hand. At the end the page reveals what happened and shows each student their own paths and errors. Optionally, students add an anonymous summary to a **class view** you put on the projector.

## The links

Your site is wherever the project is deployed, for example `https://YOUR-SITE.pages.dev/` ([DEPLOYMENT.md](DEPLOYMENT.md)). The **instructor page**, `https://YOUR-SITE.pages.dev/instructor`, shows every link for your address with a Copy button, builds custom protocols and sets up class views.

| Give students this link | What each student gets |
|---|---|
| `https://YOUR-SITE.pages.dev/` | **Sudden or Gradual, at random** (50/50, decided when they press Start) |
| `https://YOUR-SITE.pages.dev/?c=k7m2` | **Sudden**: the 45° rotation appears all at once |
| `https://YOUR-SITE.pages.dev/?c=p4x9` | **Gradual**: the rotation grows from 0° to 45° over 8 reaches |
| `https://YOUR-SITE.pages.dev/?c=demo` | **Quick Demo**: 16 reaches, a two-minute introduction |

Students are not told which version they have until the end; the codes are deliberately meaningless. On the instructor page you can also change the rotation (15–60°), the length (16, 40 or 64 reaches), the aftereffect cursor and the catch trials, and copy a **custom link**. Custom sessions are never pooled with the standard versions.

## What students need

A laptop or desktop, a **physical mouse** (trackpads work poorly), **Chrome or Edge**, and about ten minutes. Phones and tablets do not work.

## Running it in class

1. **Before class**, on the instructor page, pick a class code (for example `NEURO451`), open the class view and put it on the projector. It refreshes every 15 seconds.
2. Share one student link. Say only: *"Follow the on-screen instructions, make each reach one quick movement, and don't discuss it until everyone has finished."*
3. Students press **Start**, make 6 practice reaches, then 40 recorded reaches (two to four minutes).
4. They answer three optional questions, then see the reveal and their own results.
5. Tell them the class code. At the bottom of their results they type it and press **Share anonymously** (optional; never automatic). Their curve appears on the projector.
6. Ask them to **download their session file** or take screenshots before closing the tab: their full results are kept nowhere else.

## Reading the class view

- **Path error** (shown first): how far each student's cursor path strayed from the straight line to the target. It jumps when the rotation appears, shrinks as students adapt, and goes **negative** on the catch trials and in the aftereffect block if the adaptation carried over. Sudden students experience a large error that decays; gradual students never experience a large error. That contrast is the point of the two versions.
- **Initial direction**: where each hand set off, a quarter of the way out. It shows the change in *aim*, before steering. Switch between the two with the buttons above the chart.
- **Expect partial effects.** An aftereffect of 10–20° (not 45°) is typical after a short session, and single students are noisy. The class mean, with its ±1 SD band, is where the pattern is clearest. Everything on the page is descriptive, not a statistical test.

Discussion prompts: Where did your hand aim while the rotation was on? What happened on the catch trials? Did your first reach after the rotation was removed still veer? Did you notice the rotation, and did you try to aim differently?

## If a student gets stuck

| They say | What is happening |
|---|---|
| "My pointer vanished." | The page captures the mouse during the task. **Esc** releases it; **Resume** continues. A reach that was cut off is repeated. |
| "The dot disappeared." | Intended on some reaches. Reach out to the lit target anyway and hold still; the reach registers when it flashes. |
| "It says Too slow." | Each reach should be one quick, smooth movement. The reach still counts; just go a little quicker next time. |
| "It says time ran out." | The reach has 6 seconds to get onto the target and hold there for 0.4 s. |
| "Start is greyed out." | The browser cannot capture the mouse. Use desktop Chrome or Edge. |
| "Share says it is not available." | Class sharing has not been set up on this site ([DEPLOYMENT.md](DEPLOYMENT.md)). Everything else works. |

## Before first use

The software passes its automated tests, including complete simulated sessions in Chrome and Edge, but **please try it yourself with a physical mouse**: check the dot speed, the pace of the "Too slow" note, and that a full session fits your slot (the results page reports the time taken). If you set up class sharing, share a test session to a test code and delete it afterwards ([DEPLOYMENT.md](DEPLOYMENT.md)).

## Data and privacy

- No accounts, no names. A student's full results stay in their browser unless they download them.
- Class sharing is opt-in per student and sends only a compact anonymous summary (two numbers per reach, which version they did, and their answer to the strategy question). The class view cannot show which line is whose. A class code is not a password. Delete a class's data when you are done ([DEPLOYMENT.md](DEPLOYMENT.md#deleting-a-classs-data)).
- These are teaching defaults, not a research protocol. If you want to use the data for research, check your institution's requirements first.
