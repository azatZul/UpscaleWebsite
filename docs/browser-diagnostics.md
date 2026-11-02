# Browser upscaler diagnostics

The browser tool sends diagnostics to the existing **UpScale** Amplitude project
(`660222`). Events remain subject to the site's analytics consent: pre-consent
events wait in tab memory; rejection discards them. Localhost and
`?analytics-debug` log to the console without sending.

## Finding a failure

Filter event properties `platform = web`, `environment = production` and
`processing_completed.result = failed`. Group by `message`, `error_stage`,
`browser_os`, `browser_engine`, `browser_version` or `app_build`. The SDK's
built-in `os` currently contains browser names, so prefer the explicit
`browser_os` field when distinguishing Windows from iOS.

New browser builds add these events:

| Event | Meaning |
| --- | --- |
| `processing_started` | A free on-device processing run began. |
| `processing_retry` | One execution attempt failed and another backend/thread configuration will be tried. This is not a final processing failure. |
| `device_processing_error` | All attempts failed, including failures in the face editor. |
| `browser_error` | An uncaught JavaScript exception or unhandled promise rejection. |

`processing_completed` retains its existing success/failed/cancelled/interrupted
outcome, with added failure diagnostics. Do not sum it with
`device_processing_error` to count failed runs.

Use `diagnostic_id` to correlate events from one page load, and the Amplitude
user/session timeline to follow imports, taps, retries and outcomes. Anonymous
browser identities are not a person's name or a reliable identity across
devices. Ask a visitor for the approximate time and browser when tracing an
existing report. Counts of events are attempts, not affected people.

Failures carry the last `operation` (download, initialize, tile, face, encode,
etc.), `engine_model`, backend, requested threads and attempt index. `model` keeps
the selected image model (`photo` or `drawing`); `engine_model` identifies the
worker model (`photo-2`, `drawing-4`, `faces`, etc.). Where the browser provides
an exception, `engine_message`, `engine_error_type` and a bounded `engine_stack`
preserve it instead of only the translated UI key. `app_build` is the tool bundle
build timestamp, and all events carry feature-support and device-memory/core
information where available. Global exceptions are deduplicated and capped at
10 per page load.

Attribution is captured on entry to the tool: `entry_path`, the referrer's domain
and the selected `utm_source`, `utm_medium`, `utm_campaign` values. It does not
reconstruct the original external source after navigation through another site
page. A missing referrer cannot distinguish direct visits from links whose
source was hidden by an app or browser.

No photo content, filenames or file objects are deliberately sent. Exception
strings are bounded and scrubbed for URLs, common local paths, email addresses
and image filenames. Full referrer URLs and arbitrary URL parameters are not
collected. Diagnostics follow the existing consent and opt-out behavior.

## Coverage limits

New fields appear only after deploying a rebuilt tool; they cannot recover
earlier lost exception details. Analytics blockers, network loss, a terminated
browser/GPU process or a failure to load the JavaScript bundle can prevent
reporting. A missing completion event is a clue, not proof of a crash. These
diagnostics do not themselves verify compatibility on physical Windows hardware.
