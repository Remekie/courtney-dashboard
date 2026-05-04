# Power Automate Flow Setup — Comms Dashboard

Use Power Automate for **Outlook + Teams** (no IT approval needed — personal flows in your Adobe tenant).

## What you're building

A scheduled flow that runs every 15 minutes:
1. Reads your Outlook inbox (unread count, flagged, meetings)
2. Reads your Outlook calendar (this week's events)
3. Reads Teams channel posts for watched teams
4. POSTs all of it to the Cloudflare Worker at `https://comms-data.remekie.workers.dev/data`

---

## Step 1: Create the flow

1. Go to **https://make.powerautomate.com** (sign in with your Adobe account)
2. Click **+ Create** → **Scheduled cloud flow**
3. Name: `Comms Dashboard — Sync`
4. Repeat every: **15 minutes**

---

## Step 2: Add Outlook — Get Emails

Add action: **Office 365 Outlook → Get emails (V3)**

Settings:
- Folder: `Inbox`
- Fetch Only Unread Messages: `Yes`
- Top: `50`
- Include Attachments: `No`
- Subject Filter: *(leave blank)*

---

## Step 3: Add Outlook — Get Calendar Events

Add action: **Office 365 Outlook → Get calendar view of events (V3)**

Settings:
- Calendar ID: `Calendar`
- Start Time: `utcNow()` (use expression)
- End Time: `addDays(utcNow(), 7)` (use expression)

---

## Step 4: Transform data with Compose

Add action: **Data Operation → Compose**

Paste this expression as the Inputs:
```json
{
  "outlook": {
    "unreadCount": @{length(outputs('Get_emails_(V3)')?['body/value'])},
    "meetings": @{take(filter(outputs('Get_emails_(V3)')?['body/value'], item => contains(item?['subject'], 'meeting') || contains(item?['subject'], 'call') || contains(item?['subject'], 'invite')), 8)},
    "people": @{take(filter(outputs('Get_emails_(V3)')?['body/value'], item => endsWith(item?['from']?['emailAddress']?['address'], '@adobe.com')), 8)},
    "flagged": @{filter(outputs('Get_emails_(V3)')?['body/value'], item => equals(item?['flag']?['flagStatus'], 'flagged'))},
    "calendar": {
      "weekLabel": "This week",
      "events": @{outputs('Get_calendar_view_of_events_(V3)')?['body/value']}
    }
  }
}
```

---

## Step 5: POST to Cloudflare Worker

Add action: **HTTP**

- Method: `POST`
- URI: `https://comms-data.remekie.workers.dev/data/outlook`
- Headers:
  - `Authorization`: `Bearer YOUR_WRITE_TOKEN_HERE`
  - `Content-Type`: `application/json`
- Body: `@{outputs('Compose')}`

Replace `YOUR_WRITE_TOKEN_HERE` with the token you set via `wrangler secret put WRITE_TOKEN`.

---

## Step 6: Repeat for Teams (optional)

Add action: **Microsoft Teams → List channel messages**

- Team: *(select AEM NAM Expert SCs or whichever team)*
- Channel: *(select General)*
- Message Count: `20`

Then add another HTTP action posting to `/data/teams`.

---

## Testing

1. Click **Save**, then **Run manually**
2. Check `https://comms-data.remekie.workers.dev/data` to see the stored payload
3. Reload the dashboard — data should appear live

---

## Setting WRITE_TOKEN

```bash
cd worker
wrangler secret put WRITE_TOKEN
# Enter a strong random string, e.g.: openssl rand -hex 32
```

Store this token in Power Automate as a **Connection reference** or paste directly into the HTTP action (not ideal but works for personal use).
