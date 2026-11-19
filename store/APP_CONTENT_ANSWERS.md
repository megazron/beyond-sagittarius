# Play Console answers for Beyond Sagittarius

Prepared 2026-11-19 from the game as it is on main and from Google's pages as of that date.
Each section matches a page in Play Console > your app > **Policy and programs > App content**
(older consoles call it "Policy > App content"). Where Google words a question differently on the day,
answer what is true; the facts are below.

Facts behind every answer:
- Free. No ads. No in-app purchases. No accounts, no sign-in, no chat, no other players.
- The Android app has **no permissions at all** (no internet). It cannot send anything anywhere.
- Saves and settings stay in the app's private storage on the phone.
- The player can type a character name. It stays on the phone.

## Privacy policy

URL: `https://megazron.github.io/beyond-sagittarius/privacy.html`
(Generated from PRIVACY.md. The game's Legal screen links to it too.)

## Ads

**No, my app does not contain ads.**

## App access

**All functionality is available without any special access.** (No login, no codes, nothing locked.)

## Content rating (IARC questionnaire)

- Email for the rating certificate: `<YOUR CONTACT EMAIL>` (yours, not public)
- Category: **Game** (not "Social or Communication", not "Reference").

| Question area | Answer | Why |
| --- | --- | --- |
| Violence | **Yes** | You brace a spear against a predator creature at night (level 7) and drive it off; you can die and wake up again. |
| ...against realistic humans or human-like characters | **No** | Only an alien creature is fought. |
| ...blood / gore / dismemberment | **No** | No blood is shown. (One line of dialogue mentions an alien "blood doesn't freeze"; that is not depicted violence.) |
| ...is it fantasy / cartoon / non-realistic | **Yes, fantasy creature** | |
| Fear / horror | **Yes, mild** | Comic horror tone: a predator stalking at night ("Eyes in the dark. Six of them."), a dark forest, peril. |
| Sexuality / nudity | **No** | |
| Language (profanity, crude humour) | **No profanity.** Crude humour: **No** (it is Gen Z jokes like "skill issue"; if you add jokes later, check again) | |
| Controlled substances | **No use.** If asked about *references*: the science codex explains fermentation (yeast makes alcohol, alcohol becomes vinegar). Answer "references to alcohol: Yes, educational, no consumption" if the form asks about references; otherwise No. | |
| Gambling / simulated gambling | **No** | |
| Users can interact or exchange content | **No** | No chat, no multiplayer in the Android app. |
| Shares the user's location with others | **No** | |
| Digital purchases | **No** | |
| Random items for purchase (loot boxes) | **No** | |
| Unrestricted internet / web browser | **No** | The only links (privacy, README) open the phone's own browser. |
| Discriminatory content / hate | **No** | |

Expected outcome: roughly PEGI 7 to 12 / ESRB Everyone 10+ to Teen, decided by IARC, not by you.
Do not tick "made for children".

## Target audience and content

- Target age groups: **13-15, 16-17, 18 and over**. Do **not** tick any group under 13.
- Google notes 13-15 and 16-17 "may be considered to include children in some locales". If Play then asks
  "Could your store listing unintentionally appeal to children?" answer **No**: the listing is a dark
  sci-fi survival story with comic horror, no cartoon mascots, no "kids" wording.
- Is the app in the Designed for Families programme? **No** (you chose 13+, not Families).
- If you would rather avoid every child-policy question, choose **16-17 and 18+** only. That is still honest
  ("Made for a general teen audience" in the game's Legal screen fits both).

## Data safety

Section "Data collection and security":
- Does your app collect or share any of the required user data types? **No.**
- (The form then skips the per-type questions.)
- Is all of the user data collected by your app encrypted in transit? Not asked once you answer No.
- Do you provide a way for users to request that their data is deleted? If asked: **No data is collected**
  (pick the option that says so; uninstalling the app deletes the saves).

Result on the store page: "No data collected", "No data shared with third parties".

Why this is honest: the app has no internet permission (check with `python3 tools/android/check_aab.py <aab>`).
Android's own device backup is a Google service the user turns on; it is not collection by the app.

## Government apps

**No.**

## Financial features

**My app doesn't provide any financial features.**

## Health

**My app does not have any health features.**

## News app

**No.**

## Advertising ID

**No** (the app does not use the advertising ID; there is no AD_ID permission in the manifest).

## Account deletion

Not applicable: the app has no accounts. If a question appears, answer that users cannot create accounts.

## Store settings

- App or game: **Game**
- Category: **Adventure** (story-driven survival; "Action" fits less: there is little combat yet)
- Tags (pick up to 5 from Google's list): Adventure, Survival, Sci-fi, Story-driven / Narrative, Offline
- Free or paid: **Free** (a free app can never become paid later; that is fine)
- Contact details on the listing:
  - Email: `<YOUR CONTACT EMAIL>` (required; shown publicly. Consider a separate address just for the game.)
  - Website: `https://megazron.github.io/beyond-sagittarius/` (optional)
  - Phone: leave empty
- Countries: all, or start with the ones you want; the game speaks English, Hindi and Urdu.
- Store listing languages: English (United States) default. You can add Hindi and Urdu listings later.

## In-app purchases, subscriptions, ads SDKs

None. Nothing to set up in Monetize. No payments profile needed for a free app.
