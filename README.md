# Trade Journal v2 — Cloud Storage Setup

Your data syncs across all devices and browsers. Never lose a trade.

---

## Step 1: Create Firebase Project (2 minutes)

1. Go to https://console.firebase.google.com
2. Click **"Create a project"** (or "Add project")
3. Name it `trade-journal`
4. Disable Google Analytics (you don't need it)
5. Click **"Create project"**
6. Wait for it to finish, click **"Continue"**

## Step 2: Create Firestore Database (1 minute)

1. In your Firebase project, click **"Build"** in the left sidebar
2. Click **"Firestore Database"**
3. Click **"Create database"**
4. Select **"Start in test mode"** (this allows read/write access)
5. Choose the closest server location to you
6. Click **"Enable"**

## Step 3: Get Your Firebase Config (1 minute)

1. Click the **gear icon** (⚙️) next to "Project Overview" in the top left
2. Click **"Project settings"**
3. Scroll down to **"Your apps"**
4. Click the **web icon** (`</>`) to add a web app
5. Name it `trade-journal`
6. DON'T check "Firebase Hosting"
7. Click **"Register app"**
8. You'll see a code block with your config. It looks like this:

```javascript
const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "trade-journal-xxxxx.firebaseapp.com",
  projectId: "trade-journal-xxxxx",
  storageBucket: "trade-journal-xxxxx.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123"
};
```

9. **Copy these values**

## Step 4: Paste Config Into Your Code

1. Open the file `src/firebase.js`
2. Replace the placeholder values with YOUR values from Step 3:

```javascript
const firebaseConfig = {
  apiKey: "YOUR_ACTUAL_API_KEY",
  authDomain: "YOUR_ACTUAL_AUTH_DOMAIN",
  projectId: "YOUR_ACTUAL_PROJECT_ID",
  storageBucket: "YOUR_ACTUAL_STORAGE_BUCKET",
  messagingSenderId: "YOUR_ACTUAL_SENDER_ID",
  appId: "YOUR_ACTUAL_APP_ID",
};
```

## Step 5: Upload to GitHub

**If updating your existing repo:**
1. Go to your GitHub repo
2. Delete all existing files (or create a new repo)
3. Upload ALL files from this folder
4. Make sure structure looks like:
```
├── index.html
├── package.json
├── vite.config.js
└── src/
    ├── main.jsx
    ├── firebase.js
    └── TradeJournal.jsx
```
5. Commit changes

## Step 6: Redeploy on Vercel

If using existing Vercel project:
1. Go to Vercel dashboard
2. It should auto-deploy when you push to GitHub
3. If not, click **"Redeploy"**

If new Vercel project:
1. Go to https://vercel.com
2. Add new project → select your repo
3. Deploy

## Step 7: Secure Your Database (Do this after testing!)

After confirming everything works:
1. Go to Firebase Console → Firestore Database → **Rules** tab
2. Replace the rules with:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /trades/{tradeId} {
      allow read, write: if true;
    }
  }
}
```

Note: "test mode" rules expire after 30 days. The rules above keep it open. Since this is a personal journal, this is fine. If you want to add login protection later, we can add Firebase Auth.

---

## Done!

Your trade journal now syncs across:
- Any browser
- Any device
- Phone and desktop
- Data is stored in Google's cloud (Firebase)
- Data persists forever (won't be erased)

Just bookmark the Vercel URL and use it anywhere.
