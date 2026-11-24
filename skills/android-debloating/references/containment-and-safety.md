# Intervention Ladder, Containment Patterns & Safety Traps

Consult in **Phases 2, 3, and 4** when selecting disable vs. uninstall vs. AppOps containment and auditing post-reboot behavior.

---

## 1. Intervention Decision Table

| Package Location & Coupling | Method | Rollback |
| :--- | :--- | :--- |
| Pure `/data/app` preload (`Hidden system packages: NONE`) | `adb shell pm uninstall <pkg>` (or `--user 0`) | Reinstall from store/APK |
| System package (`/system`, `/product`, `/system_ext`, or `/data/app` update over a system stub) | `adb shell pm disable-user --user 0 <pkg>` | `adb shell pm enable <pkg>` |
| OS-coupled or PackageManager-protected **non-`uid=1000`** package | AppOps + standby containment (section 3) | Reset AppOp (`allow`/`default`) & bucket |
| Protected package sharing `sharedUserId=android.uid.system` (`uid=1000`) | Leave untouched (`enabled=0`); disable unused companion UI apps instead | N/A |

**Why disable instead of `--user 0` uninstall for system stubs:** Removing system packages often leaves framework callers throwing `NameNotFoundException` in tight retry loops. `pm disable-user --user 0` marks `enabled=3` cleanly without breaking system resolution.

---

## 2. Known System Traps (Verify Before Mutating)

### A. The `sharedUserId=android.uid.system` (`uid=1000`) AppOps Trap
AppOps modes set via `cmd appops set <pkg> ...` are often enforced at the **UID** (`Uid mode`) level. When a package shares `sharedUser=android.uid.system/1000`, setting restrictive UID AppOps on that package applies to **all `uid=1000` components** (Android System, Settings, `location.fused`, hardware controllers).
- Always check `dumpsys package <pkg>` for `sharedUser=` first.
- Never apply `cmd appops set` to any `uid=1000` package.

### B. `SYSTEM_FIXED | GRANTED_BY_DEFAULT` Notification Permissions
Privileged system apps may hold `android.permission.POST_NOTIFICATIONS` with flags `[ SYSTEM_FIXED|GRANTED_BY_DEFAULT ]`. Android keeps their `POST_NOTIFICATION` AppOp locked to `allow` even after `cmd appops set ... POST_NOTIFICATION ignore`.
- Check `dumpsys package <pkg> | grep -i POST_NOTIFICATIONS` before relying on `POST_NOTIFICATION ignore`.
- If `SYSTEM_FIXED`, suppress unwanted nudges via `RUN_ANY_IN_BACKGROUND ignore`, setup-completion flags, `pm clear` (when safe and allowed), and `am force-stop`.

### C. `PERSISTENT` System Stubs Respawn Idle After Reboot
Some `PERSISTENT` system packages (`pkgFlags` includes `PERSISTENT`) with `enabled=3` still spawn an empty stub process on cold boot.
- Verify via `dumpsys activity services <pkg>` and `dumpsys jobscheduler` that the respawned stub has **0 active services** and **0 scheduled jobs** rather than treating the process entry as a disable failure.

### D. Post-Reset / Post-Reboot `reason=u-su` Standby Bucket Resets
After a factory reset or system initialization, Android's `AppStandbyController` promotes touched/updated packages to bucket `10` (`ACTIVE`, `reason=u-su`) with a 2-hour expiry timer, overriding pre-reboot `am set-standby-bucket ... restricted` (`45`) calls.
- Wait after `adb reboot` until both `sys.boot_completed` equals `1` **and** `sys.user.0.ce_available` equals `true` (User 0 unlocked), let boot init settle briefly, and re-apply:
  ```bash
  adb shell am set-standby-bucket <pkg> restricted
  ```
- Confirm `bucket=45 reason=f` (`FORCED`) in `dumpsys usagestats`.

---

## 3. Non-`uid=1000` Containment & Two-Layer Messaging Rules

### Hardening OS-Coupled Viewers/Stores
For packages kept enabled because the OS invokes them interactively (e.g., default store or quick-preview viewer):
```bash
adb shell cmd appops set <pkg> RUN_ANY_IN_BACKGROUND ignore
adb shell am set-standby-bucket <pkg> restricted
# Only if POST_NOTIFICATIONS is not SYSTEM_FIXED:
adb shell cmd appops set <pkg> POST_NOTIFICATION ignore
adb shell pm revoke <pkg> android.permission.POST_NOTIFICATIONS
```

### Messaging App Policies (Mode 1 vs. Mode 2)
- **Mode 1 (On-Demand Only — e.g., infrequent work chat):** Place in Deep Sleep / `restricted` standby (`45`); accept missed pushes when closed.
- **Mode 2 (Real-Time Push at `0% CPU` When Closed):** Keep `com.google.android.gms` background execution **unrestricted** (`RUN_ANY_IN_BACKGROUND allow`) for FCM delivery, keep the messaging app out of Deep Sleep, and enable **Cached Apps Freezer** (`settings put global cached_apps_freezer enabled`) so the OS freezes the process cleanly in memory when backgrounded and wakes it on incoming FCM.

---

## 4. Onboarding, GMS & Carrier Packages to Preserve

- **`com.google.android.setupwizard`:** Keep enabled (`pm disable-user` breaks Google Account sign-in flows). To silence persistent *"Finish setting up your device"* foreground notifications (`suw_consolidate_foreground_notification`):
  ```bash
  adb shell settings put global device_provisioned 1
  adb shell settings put secure user_setup_complete 1
  adb shell settings put secure user_setup_personalization_state 10
  adb shell cmd appops set com.google.android.setupwizard RUN_ANY_IN_BACKGROUND ignore
  adb shell am force-stop com.google.android.setupwizard
  ```
- **`com.google.android.partnersetup`:** Keep enabled (Chrome, Google Search, and Gemini query `RlzAppProvider`).
- **`com.google.android.syncadapters.calendar`:** Keep enabled if Google Calendar sync is required.
- **Carrier / OMC Provisioning Agents:** Keep enabled so SIM switches, APN profiles, VoLTE, and Wi-Fi Calling stay functional.

---

## 5. Standard System & Privacy Tuning Checks

Verify support per device before applying:
- `cached_apps_freezer=enabled` (global) → requires reboot + verify via `dumpsys activity | grep use_freezer`.
- Animation scales (`window_animation_scale`, `transition_animation_scale`, `animator_duration_scale` = `0.5`).
- Private DNS (`private_dns_mode=hostname`, `private_dns_specifier=<provider>`) → verify `ValidatedPrivateDnsAddresses` in `dumpsys connectivity` on an active network.
- `uwb_enabled=0` (global, if UWB hardware present and unused) and `clipboard_show_access_notifications=1` (secure).
- `adb shell cmd package compile -m speed-profile -a` after major package removals.
