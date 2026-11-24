# Samsung One UI Device Notes

Consult **only when `ro.product.manufacturer` is `samsung`**. Verify every package and prop on the live phone—One UI releases and regional CSCs vary.

---

## 1. Carrier Provisioning vs. Setup Bloat Queue (`omcagent`)

- **`com.samsung.android.app.omcagent`** handles SIM/CSC provisioning, APNs, VoLTE, and Wi-Fi Calling (`sharedUser=android.uid.system/1000`, `pkgFlags` includes `ALLOW_CLEAR_USER_DATA`). **Keep enabled.**
- After initial setup or reset, `omcagent` often queues multi-gigabyte preload bundles on `channel=SUW_CHANNEL` (*"App installation paused — Waiting for Wi-Fi to install apps"*).
- Wipe that stalled download queue cleanly before connecting Wi-Fi without breaking CSC/VoLTE:
  ```bash
  adb shell pm clear com.samsung.android.app.omcagent
  adb shell am force-stop com.samsung.android.app.omcagent
  ```

---

## 2. Samsung Find My Mobile (`fmm`) vs. Google Find Hub

- When the user avoids Samsung Accounts and wants Google-only tracking, configure **Google Find Hub** (`Settings → Google → All services → Find Hub`, plus Device Admin if needed, verified via `android.com/find`) instead of Samsung's *Find My Mobile* OAuth flow.
- **`com.samsung.android.fmm`** runs under `sharedUser=android.uid.system/1000` (`DIRECT_BOOT_AWARE`, bucket `5`) and may reject `pm disable-user` on newer One UI builds. Leave `fmm` untouched (do not set AppOps on `uid=1000`), ensure **`com.samsung.android.app.find`** (Samsung Find UI app) is uninstalled, and disable **`com.sec.spp.push`**. Verify `dumpsys activity services com.samsung.android.fmm` stays empty and `fmm_offline_find_support=N`.

---

## 3. Samsung Gallery Viewer-Only Lockdown

Samsung Gallery (`com.sec.android.gallery3d`) delegates heavy background ML indexing and story/collage notifications to **6 background priv-app daemons**. Disabling those 6 daemons + containing the Gallery package preserves Camera bottom-left quick-preview with minimal RAM:

- **Disable (`pm disable-user --user 0`):**
  - `com.samsung.storyservice` (collages/stories notifications)
  - `com.samsung.faceservice` (background face clustering; does **not** affect Face Unlock hardware)
  - `com.samsung.petservice` (pet clustering)
  - `com.samsung.android.app.moments` (video highlight teasers)
  - `com.samsung.mediasearch` (periodic semantic search indexing)
  - `com.samsung.videoscan` (background video analysis)
- **Keep enabled:** `com.samsung.cmh` and `com.samsung.ipservice` (Camera → Gallery quick-preview queries `cmh` and crashes if `cmh` is disabled).
- **Contain `com.sec.android.gallery3d`:** `RUN_ANY_IN_BACKGROUND ignore`, `restricted` standby bucket (`45`), `POST_NOTIFICATION ignore`, and `pm revoke ... POST_NOTIFICATIONS`.

---

## 4. Camera Voice Control, Call Recording & Bixby

- **Camera Voice Control (*"Smile"*, *"Capture"*, *"Record video"*):** On Galaxy S-series One UI builds, test `logcat` while triggering Camera voice commands—Samsung embeds its native acoustic matcher (`VoiceCommand-CameraBargeIn`) directly inside `com.sec.android.app.camera`, independent of `bixby.wakeup` and offline speech packs. Confirm empirically before removing Bixby components on other models.
- **Native Call Recording vs. Spam Filtering:** If Samsung Phone provides native call recording and the user installs Google Phone for caller ID/spam, keep **Samsung Phone** as Default *Phone app* (`ROLE_DIALER`) and assign **Google Phone** only to Default *Caller ID & spam app* (`ROLE_CALL_SCREENING`).

---

## 5. Samsung System Tuning & Deferred Lockdowns

- **RAM Plus:** `adb shell settings put global ram_expand_size 0` disables flash-backed zRAM expansion, **engaging only after reboot** (`persist.sys.zram.ram_expand_size`). Verify in `/proc/meminfo` that `SwapTotal` dropped to the hardware zRAM baseline.
- **Freezer / OLAF:** After `cached_apps_freezer=enabled` + reboot, verify `getprop sys.perf.olaf` and `dumpsys activity | grep use_freezer`.
- **Auto Blocker (`rampart`):** *Settings → Security and privacy → Auto Blocker* blocks USB ADB connections while active. Always keep it OFF during debloat and verification, and apply it alongside *Galaxy AI → Process data only on device* as the final UI step after all ADB work is verified.
