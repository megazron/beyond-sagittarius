# Beyond Sagittarius on Google Play: step by step

My first Play Store game. Personal developer account, developer name **MegaZroN**, free, no ads, no purchases, 13+.
Rules checked against Google's own pages on 2026-11-19. Google changes them: when a step looks different, trust the Console.

Everything prepared is in this folder:

| File | What it is |
| --- | --- |
| `listing-en.txt` | App name, short and full description (lengths already checked) |
| `APP_CONTENT_ANSWERS.md` | The answer to every App content form (ads, data safety, content rating, audience...) |
| `graphics/icon-512.png` | Store icon, 512 x 512, 32-bit PNG |
| `graphics/feature-graphic-1024x500.png` | Feature graphic, 1024 x 500, 24-bit PNG |
| `screenshots/*.jpg` | Eight phone screenshots from the real app build, 1920 x 1080 landscape (two spares in `screenshots/extra/`) |
| `release.sh` | One command to build a new signed upload (AAB) |

The first signed bundle is in `~/beyond-sagittarius-release/` (see the end of this guide).
The upload key is in `~/beyond-sagittarius-keys/`. **Back that folder up today** (its README says how).

---

## 1. Create the developer account (one time, about 30 minutes, then a few days of checks)

1. Go to https://play.google.com/console/signup with the Google account you want to own the game.
   Use an account you will keep for years. It does not have to be your main Gmail.
2. Choose **Yourself** (personal account). Not "An organisation": you have no company, and you do not need a D-U-N-S number.
3. Developer name: **MegaZroN**. This is what the store shows under the game. (Rules: no emoji, no all caps,
   nothing like "best" or "#1". "MegaZroN" is fine.)
4. Fill in your legal name and address as on your ID. Google shows your **name and country** publicly on the
   store page. Your full address is shown only if you sell things on Play; this game is free, so it is not.
5. Contact email (private, for Google) and phone. Then a **developer email** that IS public on the store
   listing. Consider making a separate address just for the game.
6. Pay the one-time **US$25** fee with a credit or debit card in your own name (prepaid cards are refused).
7. Verify your identity: upload a government ID when asked. Verify the phone number and the email.
8. Personal accounts must also **verify access to an Android phone**: install the **Google Play Console** app
   on your phone and sign in with the same account when the Console asks.
9. Wait for the verification email (usually a few days).

## 2. Create the app

Play Console > **Create app**:
- App name: `Beyond Sagittarius`
- Default language: English (United States) - en-US
- App or game: **Game**
- Free or paid: **Free**
- Tick the two declarations (Developer Program Policies, US export laws) > **Create app**.

The package name is fixed by the first upload: `com.megazron.beyondsagittarius`. It can never change.

## 3. Fill in the dashboard tasks ("Set up your app")

Use `APP_CONTENT_ANSWERS.md` for every form. In order:

1. **Privacy policy**: `https://megazron.github.io/beyond-sagittarius/privacy.html`
2. **App access**: all functionality available without special access.
3. **Ads**: No.
4. **Content rating**: start questionnaire, category Game, answers from the file. You get ratings for all regions at once.
5. **Target audience and content**: 13-15, 16-17, 18+ (nothing under 13). Not appealing to children.
6. **Data safety**: No data collected or shared.
7. **Government apps**: No. **Financial features**: none. **Health**: none. **News**: No.
8. **Advertising ID**: No.
9. **Store settings**: category **Adventure**, tags from the file, contact email (public), website optional.
10. **Main store listing**:
    - App name, short description, full description: copy from `listing-en.txt`.
    - App icon: `graphics/icon-512.png`
    - Feature graphic: `graphics/feature-graphic-1024x500.png`
    - Phone screenshots: upload the 8 files in `screenshots/` (landscape 1920 x 1080 counts for game promotion,
      which wants at least 3 landscape gameplay shots).
    - Tablet screenshots are optional; the same 1920 x 1080 files are accepted for 7" and 10" tablets
      (16:9, at least 1080 px) if you want the game to look complete on tablets.
    - Video: optional. A YouTube link (public or unlisted, ads off, not age-restricted) of the title sequence
      or a minute of play helps games a lot. You can add it later.

## 4. Internal testing (fast, only you and up to 100 people you name)

1. **Test and release > Testing > Internal testing > Create new release.**
2. If asked about app signing: accept **Play App Signing** (Google keeps the real signing key; your file is the upload key).
3. Upload `~/beyond-sagittarius-release/beyond-sagittarius-1.0.0-1.aab` (copy it to Windows first, see below).
4. Release name: `1.0.0 (1)`. Release notes: "First test build."
5. Save > Review release > **Start rollout to Internal testing**.
6. **Testers** tab: create an email list with your own Gmail. Copy the **opt-in link**, open it on your Android
   phone, accept, install from the Play Store.
7. Play it on your phone. Check: it starts, sound, touch controls, back button (pauses; on the title it asks
   before leaving), switching apps pauses the game, Continue works after closing it.
   **This is the first run on a real phone**, so do it before inviting anyone.

## 5. Closed testing: 12 testers for 14 days (required for new personal accounts)

Google's rule (checked 2026-11-19): before you can publish to production, a closed test must have had
**at least 12 testers opted in, continuously, for the last 14 days**. Testers who leave early do not count.
Recruit 15 to 20 so dropouts do not reset you.

1. **Testing > Closed testing > Create track** (or use the default "Alpha"). Create new release, add the same
   AAB (or a newer one), roll out.
2. Testers: add a Google Group or an email list with their Gmail addresses (they must use these Google
   accounts in the Play Store on an Android phone).
3. Send them the opt-in link. They tap **Become a tester**, then install from Play. Ask them to keep it installed
   and play a little on several days, and to send feedback (Play lets testers send private feedback; a
   WhatsApp group or a form works too). Keep notes: you will need them in step 6.
4. Ship at least one update during the test if you fix anything (`store/release.sh`, see section 8).
5. Wait until the dashboard shows the 14 days with 12+ testers as done.

## 6. Apply for production

Dashboard > **Apply for production**. The form asks (have answers ready):
- About the closed test: how easy it was to recruit testers, whether they used all features, how their use
  compared with what you expect from real players, a summary of the feedback and how you collected it.
- About the game: who it is for (13+ players who like story-driven sci-fi survival, also in Hindi and Urdu),
  what makes it different (survival that rebuilds real science one discovery at a time, a narrator who judges you,
  three languages with voices), how many installs you expect in the first year (be modest and honest).
- Production readiness: what you changed after testing, and how you decided it was ready.

Google usually answers within 7 days. Then: **Production > Create new release**, pick the AAB, choose countries,
roll out (you can start with a staged rollout, for example 20%). Review of the first release can take a few days.

## 7. Copy the files to Windows for uploading

The bundle is about 127 MB, so it is not copied to Downloads automatically. In WSL:

    cp ~/beyond-sagittarius-release/*.aab /mnt/c/Users/<you>/Downloads/

Or in Windows Explorer open `\\wsl$\Ubuntu\home\<you>\beyond-sagittarius-release\`.

## 8. Updates (one command)

From the repo (main, with the latest game):

    store/release.sh            # same version name, versionCode + 1
    store/release.sh 1.1.0      # new version name, versionCode + 1

It builds the web game, copies it into the Android project, builds and signs the AAB, checks it
(target SDK, no permissions, size, 16 KB pages) and puts it in `~/beyond-sagittarius-release/`.
Then commit `android/app/version.properties`, and in Play Console create a new release on the track you want
(internal, closed or production) and upload the new file. Every upload needs a higher versionCode; the script
takes care of that.

Version scheme: `versionName` is what players see (1.0.0, 1.1.0 for new levels, 1.0.1 for fixes);
`versionCode` is a counter that only goes up (1, 2, 3...).

## 9. Things to keep in mind

- **Target API**: from 2026-08-31 new apps and updates must target Android 16 (API 36). This build does.
  Google raises it every August; next year expect API 37. Bump `compileSdkVersion`/`targetSdkVersion` in
  `android/variables.gradle` (and Capacitor if needed) before then.
- **Size**: Play's limit for the base download is far above this game's ~126 MB download. Over 200 MB, Play warns
  players on mobile data, so keep an eye on it as levels grow.
- **16 KB page size**: the app has no native code, so it complies. If a future plugin adds `.so` files,
  `tools/android/check_aab.py` will check them.
- **No internet permission**: the game is fully offline. If you ever add something online, you must add the
  INTERNET permission, update the privacy policy and redo the Data safety form first.
- **Lost upload key**: Play Console > Test and release > App integrity > request an upload key reset.
- **Android developer verification** (Google's 2026-27 programme for sideloaded apps): for apps on Play your
  Play identity verification already counts; nothing extra to do.

## 10. What was tested before the first upload (2026-11-19)

- `tools/android/check_aab.py`: package id, version 1.0.0 (1), minSdk 29, targetSdk 36, no user permissions,
  no native code (16 KB rule met), bundle marked PAGE_ALIGNMENT_16K, download size about 126 MB, signed with the upload key.
- `tools/android/app_smoke.py`: the exact files inside the app in an emulated Android phone (touch, 1920 x 1080)
  with Capacitor's own bridge script: boots offline, New Game reaches the playable prologue, the thumbstick moves,
  back opens and closes the pause menu, back on the title asks "Leave Beyond Sagittarius?", the app going to the
  background pauses, silences and saves, Continue works after a restart, and no request leaves the bundle.
- **Not yet run on a real Android system.** This PC cannot start the Android emulator: my Linux user is not in the
  `kvm` group. To allow it once: `sudo usermod -aG kvm $USER`, restart WSL (`wsl --shutdown`), then an emulator
  can be installed with `sdkmanager "emulator" "system-images;android-36;google_apis;x86_64"`.
  Internal testing on your own phone (step 4) is the real first check.
