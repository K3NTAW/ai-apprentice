These checks are run by the human against the real Supabase project (free tier, built-in sender) before merge. The unit tests mock Supabase and do not replace them.

Use placeholders only (`<origin>`, `<email>`). Never paste real keys, passwords or project urls into this file.

# Password login checks

Covers `/login` (`src/app/login/*`), `/api/auth/bootstrap`, `/auth/reset` and `src/lib/auth/passwordLogin.ts`.

## Dashboard prerequisites

1. Authentication > Sign In / Providers > Email: enabled, password sign-in allowed, minimum password length 8.
2. Authentication > URL Configuration > Redirect URLs: `<origin>/auth/callback**` and `<origin>/auth/reset`.
3. Confirm email: note whether it is off (current) or on; checks 3 and 4 differ.

## Desktop app

1. Open the app signed out. The login shows 'Sign in' and 'Create account' tabs, email and password, a Show/Hide toggle and 'Forgot password?'. No code entry, no 'Email me a link'.
2. 'Create account' with a password under 8 characters, or two different passwords: the form says so, nothing is created.
3. 'Create account' with a new `<email>` and a valid password. Confirm email off: lands on `/agents` with a personal workspace. Confirm email on: "Check your email", nothing else happens until the link is opened.
4. 'Create account' again with the same `<email>`: "An account with this email already exists. Sign in instead." (confirm email off; with it on Supabase answers as if it worked and no session is created).
5. Sign out, 'Sign in' with a wrong password: "Wrong email or password." With the right one: lands on `/agents`.
6. Quit and relaunch: still signed in.

## Browser

7. `<origin>/login` shows email + password and an 'Email me a link' button; the link flow still lands through `/auth/callback`.
8. Sign in with password in the browser: lands on `/agents` (or a given safe `?next`).

## Forgot password

9. In the app, 'Forgot password?', enter `<email>`: "Check your email". The default Reset Password message arrives.
10. Open its link in the system browser: `/auth/reset` shows "Set a new password". Set one (8+ characters, both fields equal): "Password changed. Sign in again in the app". The address bar no longer shows the tokens.
11. Sign in in the app with the new password: works. The old one: "Wrong email or password."
12. Open the same reset link again: "Link not valid".

## Throttle

13. `curl -i -X POST -H 'content-type: application/json' -d '{}' <origin>/api/auth/bootstrap` without a session: 401 (from the proxy). With a session, the 31st call within 10 minutes from one IP answers 429 `{"error":"rate_limited"}`.
