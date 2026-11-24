# Read-Only ADB Telemetry Commands & Shell Traps

Consult in **Phases 0, 2, and 4** for reliable, read-only device inspection and clean shell scripting.

---

## 1. Device Fingerprint & Storage Check

```bash
adb get-state
adb shell getprop ro.product.manufacturer </dev/null | tr -d '\r'
adb shell getprop ro.product.model </dev/null | tr -d '\r'
adb shell getprop ro.build.version.release </dev/null | tr -d '\r'
adb shell getprop ro.build.version.sdk </dev/null | tr -d '\r'
adb shell getprop ro.build.display.id </dev/null | tr -d '\r'
adb shell getprop ro.boot.flash.locked </dev/null | tr -d '\r'
adb shell getprop ro.boot.verifiedbootstate </dev/null | tr -d '\r'
adb shell df -h /data /storage/emulated </dev/null
adb shell cat /proc/meminfo </dev/null | grep -E 'MemTotal|MemAvailable|SwapTotal|SwapFree'
adb shell dumpsys account </dev/null | grep -E 'Accounts:|Account \{'
```

---

## 2. Package Inventory & Exact `User 0` State Filtering

Capture raw baseline package lists and settings locally:

```bash
adb shell pm list packages -u </dev/null | cut -d: -f2 | tr -d '\r' | sort > state_u.txt
adb shell pm list packages -e </dev/null | cut -d: -f2 | tr -d '\r' | sort > state_e.txt
adb shell pm list packages -d </dev/null | cut -d: -f2 | tr -d '\r' | sort > state_d.txt
adb shell pm list packages -3 </dev/null | cut -d: -f2 | tr -d '\r' | sort > state_3p.txt
adb shell settings list global </dev/null | tr -d '\r' > settings_global.txt
adb shell settings list secure </dev/null | tr -d '\r' > settings_secure.txt
adb shell settings list system </dev/null | tr -d '\r' > settings_system.txt
```

### Distinguishing `enabled=3` (`DISABLED_USER`) from `enabled=4` (`DISABLED_UNTIL_USED`)

Fresh preloads before user sign-in (such as Gmail, Maps, YouTube, or Files) appear in `pm list packages -d` with `enabled=4` (`DISABLED_UNTIL_USED`). Treating all `-d` output as user-disabled will hard-disable those apps (`enabled=3`) on future replays.

Always match the indented `User 0:` package-state line explicitly (`grep -m1 "User 0:"` alone often matches an earlier `Preferred Activities User 0:` block and misses `enabled=`):

```bash
while IFS= read -r pkg; do
  [ -z "$pkg" ] && continue
  adb shell dumpsys package "$pkg" </dev/null \
    | grep -m1 -E '^[[:space:]]+User 0: .*enabled=' || true
done < state_d.txt
```

- `enabled=0` / `enabled=1`: active (`DEFAULT` / `ENABLED`)
- `enabled=2`: component/system-disabled (`DISABLED`)
- `enabled=3`: user-disabled (`DISABLED_USER` via UI or `pm disable-user`)
- `enabled=4`: idle preload (`DISABLED_UNTIL_USED`)

Verify whether a candidate package has a hidden system stub before deciding uninstall vs. disable:

```bash
adb shell pm list packages -s -u </dev/null | grep -F "<pkg>"
adb shell dumpsys package "<pkg>" </dev/null | grep -E 'codePath=|sharedUser=|pkgFlags=|privateFlags=|Hidden system|User 0:'
```

---

## 3. Live Footprint, Jobs, Notifications & Dependencies

```bash
# Memory & running processes
adb shell dumpsys meminfo </dev/null | head -n 60
adb shell ps -A -o USER,PID,RSS,NAME </dev/null | grep -iE '<pattern>'

# Background schedulers & Doze exemptions
adb shell dumpsys jobscheduler </dev/null | grep -i -C 2 '<pkg>'
adb shell dumpsys deviceidle whitelist </dev/null
adb shell am get-standby-bucket "<pkg>" </dev/null
adb shell dumpsys usagestats </dev/null | grep -E 'package=<pkg>\b.*bucket='

# Notifications & setup state
adb shell cmd notification list </dev/null
adb shell dumpsys notification --noredact </dev/null | grep -E 'NotificationRecord\(|android\.title=|android\.text='

# Connectivity, Device Admins & Crash buffer
adb shell dumpsys connectivity </dev/null | grep -oE 'UsePrivateDns: [^ ]+|PrivateDnsServerName: [^ ]+|ValidatedPrivateDnsAddresses: \[[^]]*\]|privateDnsBroken: [^ ]+'
adb shell dumpsys device_policy </dev/null | head -n 40
adb shell logcat -b crash -d </dev/null

# Verify exported/permission gates before recommending am start
adb shell 'cmd package resolve-activity -n "<pkg>/.Activity\$Inner"' </dev/null | grep -E 'name=|exported=|permission='
```

---

## 4. Verified ADB Shell Traps

1. **Protect `while read` loop stdin with `</dev/null`:** Calling `adb shell ...` inside `while IFS= read -r` without `</dev/null` lets `adb` consume lines from the file being read and silently truncate the loop.
2. **Pipe `grep`, `awk`, and `sort` on the Linux host:** Passing an unquoted `|` inside `adb shell` makes Android's `mksh` read stdin remotely or fail on missing toybox flags (`sort -h`). Always close the `adb shell ... </dev/null` command cleanly and pipe on Linux.
3. **Escape `$` in inner Activity class names:** Single-quote the remote string and escape `$` (`adb shell 'am start -n com.android.settings/.Settings\$ResetDashboardFragmentActivity'`) so neither host bash nor remote `mksh` expands `$Reset...` to empty.
4. **Never rely on directory listing under `/data/app`:** `/data/app` is not world-listable by `uid=2000`; resolve exact APK paths per package with `adb shell pm path "<pkg>" </dev/null`.
