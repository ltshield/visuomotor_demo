# Professor quick-start

**What it is.** A 5–10 minute browser activity. Students make quick mouse reaches from a center ring through targets. Partway through, without any announcement, the on-screen dot's motion is rotated 45° relative to the hand. At the end the page reveals what happened and shows each student their own movement paths and errors.

## The links

Your site address is wherever the project has been deployed, for example `https://YOUR-SITE.pages.dev/` (see [DEPLOYMENT.md](DEPLOYMENT.md)). The site's own **For instructors** page (link at the bottom of the start page) shows these four links for your address, each with a Copy button.

| Give students this link | What each student gets |
|---|---|
| `https://YOUR-SITE.pages.dev/` | **Sudden or Gradual, at random** (50/50, decided when they press Start) |
| `https://YOUR-SITE.pages.dev/?c=k7m2` | **Sudden**: the 45° rotation appears all at once |
| `https://YOUR-SITE.pages.dev/?c=p4x9` | **Gradual**: the rotation grows from 0° to 45° over 8 reaches |
| `https://YOUR-SITE.pages.dev/?c=demo` | **Quick Demo**: 16 reaches, for a two-minute introduction |

Students are not told which version they have until the end. The codes are deliberately meaningless so the address gives nothing away.

## What students need

A laptop or desktop, a **physical mouse** (trackpads work poorly), **Chrome or Edge**, and about ten minutes. Phones and tablets do not work.

## Running it in class

1. Share one link. Say only: *"Follow the on-screen instructions, and don't discuss it until everyone has finished."*
2. Students press **Start**, make 6 practice reaches, then 40 recorded reaches (a few minutes).
3. They answer three optional questions, then see the reveal and their own results.
4. Ask them to press **Download session file (JSON)**, or take screenshots, **before closing the tab**. Results are stored nowhere else.
5. Discuss. Where did your hand aim while the rotation was on? What happened on the two catch trials? Did your first reach after the rotation was removed still veer clockwise?

**To compare the two versions,** give half the class each direct link, or give everyone the general link and let chance split the room, then pool the downloaded files. One student's data cannot show a difference between versions.

## If a student gets stuck

| They say | What is happening |
|---|---|
| "My pointer vanished." | The page captures the mouse during the task. **Esc** releases it; **Resume** continues. A reach that was cut off is simply repeated. |
| "The dot disappeared." | Intended. On some reaches the dot is hidden. Keep reaching through the target. |
| "It says time ran out." | Each reach must travel all the way to the target distance within 4 seconds. |
| "Start is greyed out." | The browser cannot capture the mouse. Use desktop Chrome or Edge. |

## Before first use: try it yourself with a real mouse

The software passes its automated tests, including complete simulated sessions in Chrome and Edge. **Nobody has yet run it with a physical mouse.** Please spend ten minutes checking that:

- the dot moves at a natural speed for your mouse;
- the half-second pause after each reach (dot frozen where it crossed) feels comfortable;
- a full session fits your time slot (the results page reports the actual time taken);
- your own results make sense to you.

Pacing values live in one configuration file and are easy to change ([PRESETS.md](PRESETS.md)).

## Good to know

- Nothing is uploaded. There are no accounts and no names; data stays in each student's browser.
- These are teaching defaults, not an optimized research protocol. With only 22 rotated reaches, some students will show little or no adaptation or aftereffect. The results page tells them so.
- Changing the protocol means adding a new versioned preset, which is a small developer task ([PRESETS.md](PRESETS.md)).
