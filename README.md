# TeachMate Standalone Super Admin Console

A separate, static web dashboard for managing manual TeachMate subscriptions. It connects to the existing Firebase project `teachmate-3f24e` and does not add any entry, button, or Super Admin label to the public TeachMate login screen.

## What it does
- Private sign-in with Firebase Authentication.
- Requires BOTH a `/users/{uid}` profile with `role: "SUPER_ADMIN"` and a manually created `/superAdmins/{uid}` marker.
- Lists institution records with search and status filters.
- Activates or extends an institution for one month (₹500) or one year (₹5,000) after you confirm the payment was independently verified.
- Extends from the later of today or the current valid expiry.
- Deactivates an institution subscription without disabling student authentication.
- Writes activation/renewal/deactivation audit records to `/subscriptionAudit` in the same Firestore transaction as the subscription update.
- No Razorpay, no payment gateway, no Cloud Functions, and no Firebase Blaze dependency.

## Before using it
This project has not been deployed to your Firebase project or tested against live Firestore data. It is a client-side dashboard; its security depends on correctly deployed Firestore rules. Do not use it with production records until the rules are reviewed and tested.

## One-time administrator setup
1. Open Firebase Console for project `teachmate-3f24e`.
2. Go to Authentication → Users. Create a dedicated operator account with Email/Password, or use an existing dedicated account. Do not use a student's or institute owner's login. Copy the UID.
3. In Firestore, create `/users/{UID}` with fields:
   - `uid`: string, exact UID
   - `name`: string, your display name
   - `email`: string, your admin email
   - `role`: string, `SUPER_ADMIN`
4. Create `/superAdmins/{UID}` with fields:
   - `uid`: string, exact UID
   - `email`: string, your admin email
   - `createdAt`: Timestamp (optional)
5. Review `firestore.rules.superadmin-reference.txt`. Merge the relevant checks into your existing Firestore rules. Do not blindly replace the live rules. Ensure `/institutions/{id}` reads are allowed for Super Admins, updates are restricted to subscription fields, and `/subscriptionAudit/{entryId}` is write-once for Super Admins. Ensure no other broader allow rule lets institute users edit subscription fields or lets users write their own marker.
6. Use Firebase Rules Playground or Emulator to test the Super Admin reads/writes and all existing public app flows. Deploy rules only after tests pass.

## Run locally
Serve this folder over HTTP(S), not by opening `index.html` as a `file://` URL. For example, with Python installed:

```bash
python -m http.server 8080
```

Then open `http://localhost:8080`. Sign in with the dedicated account.

## Hosting and your Blogger blog
The dashboard is a separate static website. You can host it on a free static host such as GitHub Pages or Firebase Hosting (within its current free quota). If your Firebase project already has a Hosting site, check the existing deployment before using `firebase deploy --only hosting`, because that command could replace what is already hosted there. A separate Hosting site or GitHub Pages deployment avoids changing the current app.

To use `tmsuperadmin.blogspot.com` as the entry page:
1. Publish the dashboard at its own HTTPS URL first.
2. Open Blogger → Pages → New Page. Use a neutral title such as `Account Access`.
3. Switch the page editor to HTML view and paste `blogger-page-snippet.html` after replacing `YOUR-PUBLISHED-APP-URL` with the dashboard URL. The snippet is a launch page/button; the secure dashboard itself runs at the separate HTTPS host. Blogger Help describes creating and publishing pages: https://support.google.com/blogger/answer/165955
4. Do not add the page to the public navigation menu. If available, configure the page/blog not to be indexed. This only reduces discoverability; it is NOT access control. Firebase Authentication and Firestore rules must still protect every operation.

## Payment workflow
1. Check the UPI app/bank account yourself and confirm the exact amount has arrived.
2. Enter the transaction reference in the matching institution card.
3. Choose the monthly or annual action and confirm.
4. The app writes subscription fields and an audit log transactionally. If Firestore denies the write, review the deployed rules; do not make rules broadly permissive to bypass the error.
5. For deactivation, use the Deactivate button. It changes subscription status only; it does not disable student authentication.

## Data assumptions
The app reads institution documents from `/institutions`. It expects `name`, `ownerName`, `email`, `phone`, `ownerUid`, `institutionId`, `selectedPlan`, `subscriptionStatus`, `subscriptionExpiresAt`, `createdAt` and similar fields when present. Missing optional fields display as dashes.

## Important limitations
- This is not a full payment processor and does not verify UPI payments automatically.
- Browser UI checks are not security controls; deployed Firestore rules are essential.
- A Blogger page is public unless access restrictions are configured; hiding the link does not secure the app.
- No changes are made to the existing TeachMate institute/student app.
