# Updating HTIMedia Presenter on computers that already have it

Your songs, playlists, themes, settings and downloaded Bibles live in a separate folder, so installing a new version
never removes them.

## 1. Get the new version

When a new version is out, the app shows a blue bar at the top: **"HTIMedia Presenter x.y.z is available"** with a
**Download** button. You can also go straight to
**https://github.com/gdompey/htimedia-presenter/releases/latest**.

## 2. Install it

### Windows
1. Close HTIMedia Presenter.
2. Download **`HTIMedia-Presenter-Setup-<version>-win-x64.exe`** and run it.
3. If Windows shows "Windows protected your PC", click **More info**, then **Run anyway**.
4. The installer replaces the old version in place. Click **Finish**.
   *Using the portable `.exe`?* Just replace the old portable file with the new one.

### Mac
1. Quit HTIMedia Presenter (**Cmd+Q**).
2. Download the `.dmg` for your Mac (**arm64** for Apple Silicon M1/M2/M3/M4, **x64** for Intel), open it, and drag
   **HTIMedia Presenter** into **Applications**. Choose **Replace** when asked.
3. The first time, right-click the app and choose **Open**. If macOS says the app is damaged, run this once in
   Terminal: `xattr -cr "/Applications/HTIMedia Presenter.app"`

## 3. Get the new resources

Open the app while connected to the internet. Packs you already have update automatically, and the new default Bibles
download in the background. To add optional packs (more English Bibles, Ghanaian New Testaments), open **Resources**
and click **Download** next to each one, or **Download all**.

## 4. Check

**Settings → About** shows the version number. The welcome window does not appear again on an update.

## Moving to a new computer

Copy the **Library** folder (shown in **Settings → Library**) to the new computer, install the app, then point
**Settings → Library → Change...** at the copied folder. Bibles download again from **Resources**.
