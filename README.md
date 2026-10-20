# Drive Pro – API

שרת ה-API של Drive Pro: מאפשר להעתיק קבצים ותיקיות שמשותפים איתך ב-Google Drive ישירות לדרייב שלך.
רץ כ-Cloudflare Worker בכתובת `https://smti.uk/drive-pro/api`. הממשק נמצא בריפו [`drive-pro-ui`](https://github.com/smt-ivr/drive-pro-ui).

> הקבצים עצמם לא עוברים דרך השרת – ההעתקה מתבצעת בתוך גוגל (Drive `files.copy`).

## מבנה

```
src/
  index.js          נקודת הכניסה + ניתוב
  config.js         קריאת משתני סביבה
  http.js           HttpError, תשובות JSON, CORS
  db.js             לוג פעולות + רשימת חסומים (D1)
  pages.js          דף החזרה מגוגל אחרי התחברות
  auth/google.js    OAuth מול גוגל (קוד, רענון טוקן, פרטי משתמש)
  auth/state.js     פרמטר state חתום (HMAC) למניעת גניבת טוקנים
  auth/session.js   זיהוי המשתמש מהטוקן, עם cache
  drive/ids.js      חילוץ מזהה מקישורים (כולל resourcekey)
  drive/client.js   לקוח Drive v3: ניסיונות חוזרים ומיפוי שגיאות
  drive/service.js  פעולות: פרטי קובץ, סריקת תיקייה, יצירת תיקייה, העתקה
migrations/         סכמת D1
test/               בדיקות (node --test, עם fetch מדומה)
```

## פיתוח

```bash
npm install
cp .dev.vars.example .dev.vars   # למלא GOOGLE_CLIENT_SECRET
npm run dev                       # http://localhost:8787/drive-pro/api
npm test                          # בדיקות
npm run check                     # בדיקות + בדיקת build של ה-Worker
```

## פריסה

```bash
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put STATE_SECRET      # מומלץ: מחרוזת אקראית ארוכה
npm run db:migrate                         # פעם אחת – יוצר טבלאות שחסרות (בטוח להרצה על DB קיים)
npm run deploy
```

| משתנה | סוג | תיאור |
|---|---|---|
| `GOOGLE_CLIENT_ID` | var | מזהה ה-OAuth client |
| `GOOGLE_CLIENT_SECRET` | secret | חובה |
| `GOOGLE_REDIRECT_URI` | var | חייב להופיע ב-Google Cloud Console |
| `ALLOWED_ORIGINS` | var | אתרים (מופרדים בפסיק) שמורשים לקרוא ל-API ולקבל טוקנים. ברירת מחדל: `https://smti.uk` |
| `STATE_SECRET` | secret | חותם את פרמטר ה-state. אם חסר – משתמשים ב-client secret |
| `ROOT_FOLDER_NAME` | var | שם התיקייה הראשית בדרייב של המשתמש (`Drive Pro`) |
| `DB` | D1 | לוגים וחסימות. אופציונלי – בלעדיו הכול עובד, רק בלי לוג |

### חסימת משתמש

```bash
npx wrangler d1 execute drive-pro --remote --command "INSERT INTO blocked_users (email, reason) VALUES ('someone@example.com', 'spam')"
```

## API

כל הנתיבים תחת `/drive-pro/api` (הקידומת `/drive-pro` אופציונלית). נתיבים מסומנים 🔒 דורשים `Authorization: Bearer <access_token>`.
שגיאות מוחזרות תמיד כ-`{ "error": "<הודעה בעברית>", "code": "<קוד קבוע>" }` עם סטטוס HTTP מתאים.

| נתיב | גוף | תשובה |
|---|---|---|
| `GET /health` | – | `{ ok, version }` |
| `GET /login?origin=&return_to=` | – | הפניה לגוגל. `origin` חייב להיות ב-`ALLOWED_ORIGINS` |
| `GET /auth-callback` | – | דף שמעביר את הטוקנים ל-`origin` בלבד (popup) או חוזר ל-`return_to` |
| `POST /refresh` | `{ refreshToken }` | טוקנים חדשים. `401 session_expired` אם בוטל |
| 🔒 `GET /me` | – | `{ email, name, givenName, picture }` |
| 🔒 `POST /file-info` | `{ linkOrId }` | פרטי הפריט (קיצורי דרך נפתרים ליעד) |
| 🔒 `POST /list-folder` | `{ folderId, resourceKey? }` | `{ folderId, folderName, folderLink, files[], truncated }` – כל הדפים, עד 5,000 פריטים |
| 🔒 `POST /ensure-folder` | `{ path? , name?, parentId? }` | יוצר (או מחזיר קיימת) תיקייה תחת `Drive Pro`. `path` תומך ב-`a/b/c` |
| 🔒 `POST /copy-file` | `{ fileId, targetFolderId? , targetFolderName?, name?, resourceKey? }` | `{ id, newLink, folderId, folderLink }`. לתיקייה מוחזר `{ isFolder: true }` |

קודי שגיאה עיקריים: `missing_token`, `invalid_token`, `session_expired` (401) · `user_blocked`, `forbidden`, `copy_restricted` (403) · `not_found` (404) · `invalid_link`, `not_a_folder` (400) · `rate_limited` (429) · `storage_full` (507).
