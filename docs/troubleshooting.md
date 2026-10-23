---
title: Troubleshooting
permalink: /troubleshooting/
---

## “Invalid email or password”

Check that you are using the email address and password for your TLS Library account. If needed, copy them from your password manager and paste them into the sign-in fields.

## “Unable to sign in right now”

TLS Reader needs to reach its configured TLS Library service to sign in and load the catalog. Check your internet connection and try again. If the service is unavailable, wait a little and retry.

## My library is empty or out of date

Choose **Library → Refresh** to request the catalog again. Only publications available to your account are shown. If the catalog still does not load, sign out and sign back in.

## Password-manager autofill is unavailable

Electron does not include browser password-manager extensions or a built-in password vault. Native autofill depends on your password manager's desktop integration. Copying and pasting works without that integration:

- macOS: **Edit → Paste** or `Cmd+V`
- Windows and Linux: **Edit → Paste** or `Ctrl+V`
- Or right-click a sign-in field and choose **Paste**

## A reading control is unavailable

Reading commands are enabled after a publication is open and ready. Bookmark controls are not available in the bundled Thorium version.

## Still need help?

Visit the [TLS Reader GitHub repository](https://github.com/thorrsson/tls-reader) to review the project or report an issue.
