# Automatic startup in Copilot CLI

The skill is model-invokable. To make startup an explicit lifecycle instruction,
register the skill directory and install a user-level `sessionStart` command hook
that runs [session-start.ps1](session-start.ps1).

The hook returns `additionalContext` directing the agent to invoke the skill
before handling the first request, with the runtime session ID and startup/resume
source. The agent initializes the record when it begins processing a request.

Command hooks cover new and resumed sessions, including non-interactive operation.
A prompt-type startup hook is not used because it skips resume and `-p` sessions.

## Installation

1. Register this library's `skills` directory with `copilot skill add <directory>`.
   Directory registration keeps the definitions in place rather than copying them.
2. In the user hook directory, add a dedicated JSON file with this structure.
   Set the script argument to the absolute path of this skill's `session-start.ps1`.
   Preserve other hook files and existing settings.

```json
{
  "version": 1,
  "hooks": {
    "sessionStart": [
      {
        "type": "command",
        "exec": "pwsh",
        "args": ["-NoLogo", "-NoProfile", "-File", "<absolute-script-path>"],
        "timeoutSec": 10
      }
    ]
  }
}
```

The default user hook directory is `%USERPROFILE%\.copilot\hooks` on Windows.
When `COPILOT_HOME` is set, use its `hooks` directory instead. This adapter requires
PowerShell on the host running the CLI.

Restart the CLI to load changed hook configuration. Existing processes do not
retroactively receive their startup event. User or repository settings that
disable hooks still apply.

Registration and the hook reference the live library files. Subsequent edits
affect later sessions; if the library moves, update both the registered directory
and the hook's script path.

## Verification and removal

Confirm `copilot skill list` includes `progress-tracking`. Check a fresh session
without explicitly requesting the skill: its first task should initialize an
ignored `.ai` record and announce the chosen path. A resumed session should
reattach only its own confirmed record.

To stop automatic tracking, remove this dedicated user hook, disable the skill
with `copilot skill disable progress-tracking`, and restart the CLI. Removing
only the hook stops its lifecycle instruction; the model-invokable description
can still select the skill while it remains enabled.

Keep the library registration for other definitions, or remove it with the CLI's
skill-directory removal command when the whole directory is no longer wanted.

Reference: [Copilot hooks](https://docs.github.com/en/copilot/reference/hooks-reference).
