# 🤖 WhatsApp Bot

<p align="center">
  <img src="https://raw.githubusercontent.com/WhiskeySockets/Baileys/master/media/logo.png" alt="Baileys Logo" width="100"/>
</p>

<p align="center">
  A secure, production-ready WhatsApp bot built with <strong>Node.js (ESM)</strong> and <strong>@whiskeysockets/baileys</strong>.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg" alt="Node Version"/>
  <img src="https://img.shields.io/badge/baileys-7.0.0--rc14-blue.svg" alt="Baileys Version"/>
  <img src="https://img.shields.io/badge/tests-69%20passed-success.svg" alt="Tests"/>
  <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License"/>
</p>

> ⚠️ **Disclaimer:** This project uses the unofficial WhatsApp Web API. Automation tools may result in account restrictions or bans if abused. Use responsibly and at your own risk.

---

## 📑 Table of Contents

- [✨ Features](#-features)
- [⚡ Quick Start](#-quick-start)
- [📱 Pairing with WhatsApp](#-pairing-with-whatsapp)
- [⚙️ Configuration (`.env`)](#️-configuration-env)
- [🎮 Commands Guide](#-commands-guide)
  - [General Commands](#1-general-commands-everyone)
  - [Group Commands](#2-group-commands-group-admins)
  - [Admin Moderation](#3-admin-moderation-group-admins)
  - [Owner Commands](#4-owner-commands-bot-owner)
- [🛡️ Security & Privacy](#️-security--privacy)
- [🧪 Testing & Scripts](#-testing--scripts)
- [🚢 Production Deployment](#-production-deployment)
- [❓ Troubleshooting](#-troubleshooting)

---

## ✨ Features

- 🔐 **Secure & Private:** Multi-device auth session (`auth/`) and environment keys (`.env`) are strictly git-ignored.
- ⚡ **Multi-Prefix & Prefix-less:** Supports `.`, `!`, `/`, and `#`, plus direct prefix-less commands (`menu`, `ping`) in private chats.
- 👥 **Group Moderation:** Anti-link protection, warning strikes, kick/promote/demote, and member tagging.
- 👋 **Automated Welcome/Goodbye:** Dynamic greeting templates with custom member and group placeholders.
- 👑 **Role-Based Access Control:** Live permissions fetched directly from WhatsApp metadata to prevent stale privilege escalation.
- 🛡️ **Anti-Loop Engine:** Tracks outgoing bot messages to prevent self-echo loops while allowing owner commands typed from phones.
- 💾 **Atomic Database:** Zero-dependency file-based storage with atomic writes to eliminate race conditions.

---

## ⚡ Quick Start

### 1. Prerequisites
- **Node.js** `>= 20.0.0`
- **npm** `>= 9.0.0`
- A smartphone with WhatsApp installed

### 2. Installation

```bash
# Clone the repository
git clone <your-repo-url>
cd MyBot

# Install dependencies
npm install

# Create environment configuration
cp .env.example .env
```

### 3. Configure Your Number
Open `.env` and set your phone number with your country code (no `+`, spaces, or dashes):

```dotenv
OWNER_NUMBERS=1234567890
```

### 4. Start the Bot

```bash
npm start
```

---

## 📱 Pairing with WhatsApp

### Option A: QR Code (Terminal)
1. In `.env`, ensure `USE_PAIRING_CODE=false`.
2. Run `npm start`.
3. Open WhatsApp on your phone:
   - **Settings** > **Linked Devices** > **Link a Device**.
4. Scan the QR code printed in your terminal.

### Option B: 8-Digit Pairing Code (Recommended for VPS / Headless)
1. In `.env`, configure:
   ```dotenv
   USE_PAIRING_CODE=true
   PAIRING_PHONE_NUMBER=1234567890
   ```
2. Run `npm start`.
3. A pairing code (e.g. `ABCD-1234`) will appear in your console.
4. On your phone:
   - **Settings** > **Linked Devices** > **Link a Device** > **Link with phone number instead**.
5. Enter the code.

---

## ⚙️ Configuration (`.env`)

| Variable | Required | Default | Description |
|---|:---:|:---:|---|
| `OWNER_NUMBERS` | **Yes** | — | Comma-separated owner phone numbers with country code |
| `BOT_NAME` | No | `BEN10_Bot` | Display name of the bot |
| `BOT_VERSION` | No | `1.0.0` | Semantic version string |
| `PREFIX` | No | `.` | Primary prefix (`.`, `!`, `/`, `#` also accepted) |
| `TIMEZONE` | No | `Asia/Colombo` | Timezone for `.time` and logging |
| `SUPPORT_LINK` | No | — | WhatsApp or support link shown in `.support` |
| `USE_PAIRING_CODE` | No | `true` | `true` for 8-digit code, `false` for QR scan |
| `PAIRING_PHONE_NUMBER` | Conditional | — | Required if `USE_PAIRING_CODE=true` |
| `LOG_LEVEL` | No | `info` | Logging verbosity: `trace`, `debug`, `info`, `warn`, `error` |
| `AUTO_READ` | No | `false` | Automatically send blue read receipts |
| `MARK_ONLINE` | No | `true` | Show account as online when socket connects |
| `ANTILINK_WARN_LIMIT` | No | `3` | Max warnings before auto-kicking link offenders |

---

## 🎮 Commands Guide

### 1. General Commands (Everyone)
Available in both direct chats and groups.

| Command | Aliases | Description |
|---|---|---|
| `.menu` | `help`, `commands` | Display full command catalogue |
| `.ping` | `p` | Check bot latency and response time |
| `.alive` | `online` | Show bot online status and uptime |
| `.help <cmd>` | — | Show detailed documentation for a specific command |
| `.owner` | — | View owner contact card |
| `.runtime` | — | Display system and process uptime |
| `.time` | — | Current time in configured timezone |
| `.botinfo` | — | Version, runtime environment, and dependency info |
| `.groupinfo` | — | Group participant count, description, and metadata |
| `.jid` | — | Display your user JID and chat JID |

---

### 2. Group Commands (Group Admins)
Manage group members and automated greetings.

| Command | Permission | Description |
|---|:---:|---|
| `.tagall [msg]` | 🛡️ Admin | Mention all members in formatted batches |
| `.hidetag [msg]` | 🛡️ Admin | Broadcast a hidden mention to all members |
| `.admins` | 👥 Everyone | List all administrators in the group |
| `.tagadmin [msg]`| 👥 Everyone | Ping all group administrators |
| `.antilink on\|off` | 🛡️ Admin | Toggle automatic link removal |
| `.welcome on\|off` | 🛡️ Admin | Enable or disable welcome greeting for new members |
| `.setwelcome <msg>` | 🛡️ Admin | Set welcome message template (`{user}`, `{group}`, `{count}`) |
| `.goodbye on\|off` | 🛡️ Admin | Enable or disable goodbye message for leaving members |
| `.setgoodbye <msg>` | 🛡️ Admin | Set goodbye message template (`{user}`, `{group}`) |
| `.mute` | 🛡️ Admin | Lock bot command execution for non-admins in group |
| `.unmute` | 🛡️ Admin | Unlock bot command execution for everyone |

---

### 3. Admin Moderation (Group Admins)
*Note: Bot account must also have group admin privileges.*

| Command | Description |
|---|---|
| `.kick @user` | Remove a member from the group |
| `.add <number>` | Add a phone number to the group |
| `.promote @user` | Promote a member to group administrator |
| `.demote @user` | Demote an administrator to regular member |
| `.delete` | Delete the message you reply to |
| `.warn @user [reason]` | Issue a warning strike to a member |
| `.warnings @user` | View warning count and history for a member |
| `.resetwarn @user` | Clear all warning strikes for a member |
| `.groupopen` | Allow all participants to send messages in group |
| `.groupclose` | Restrict group messaging to administrators only |
| `.setname <name>` | Change group title |
| `.setdesc <desc>` | Update group description |
| `.invite` | Fetch the current group invite link |
| `.revokeinvite` | Reset and generate a new group invite link |

---

### 4. Owner Commands (Bot Owner)
Restricted exclusively to phone numbers listed in `OWNER_NUMBERS`.

| Command | Description |
|---|---|
| `.restart` | Soft-restart the bot socket connection |
| `.shutdown` | Gracefully shut down the bot process |
| `.setprefix <prefix>` | Dynamically update bot prefix at runtime |
| `.setbotname <name>` | Change bot display name across commands |
| `.broadcast <msg>` | Send an announcement to all linked groups |
| `.grouplist` | List all groups the bot is currently a member of |
| `.stats` | View processed messages, executed commands, and error rate |
| `.reload` | Hot-reload all command modules without restarting socket |
| `.block <number>` | Block a user from using any bot commands |
| `.unblock <number>` | Unblock a user |

---

## 🛡️ Security & Privacy

This codebase adheres to strict security standards:
- **No Credentials in Git:** `.env`, `.env.*`, and `auth/` are blocked in `.gitignore`.
- **Live Metadata Verification:** Admin status is always re-verified directly against WhatsApp group metadata to prevent privilege escalation.
- **Strict Owner Verification:** Owner privileges verify phone digits against `OWNER_NUMBERS`; group admin status never grants owner privileges.
- **Message Scrubbing:** Raw session secrets and QR buffers are never written to disk logs.

---

## 🧪 Testing & Scripts

| Command | Purpose |
|---|---|
| `npm start` | Run bot in production mode |
| `npm run dev` | Run with file watcher (`--watch`) for development |
| `npm test` | Execute complete Jest test suite (mocked socket) |
| `npm run check` | Run static Node syntax analysis across all modules |

---

## 🚢 Production Deployment

### PM2 Process Manager (Recommended)
Keep your bot alive 24/7 with automatic restarts:

```bash
npm install -g pm2
pm2 start src/index.js --name "whatsapp-bot"
pm2 save
pm2 startup
```

### Systemd Service (Ubuntu/Debian)
Create `/etc/systemd/system/whatsapp-bot.service`:

```ini
[Unit]
Description=WhatsApp Bot
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/MyBot
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=10
EnvironmentFile=/home/ubuntu/MyBot/.env

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable whatsapp-bot
sudo systemctl start whatsapp-bot
```

---

## ❓ Troubleshooting

<details>
<summary><strong>1. Bot does not respond to my messages</strong></summary>

- Verify your phone number in `.env` is formatted with country code and digits only (e.g. `94710504147`, not `+94 71 050 4147`).
- Check that the process is running with `pm2 status` or checking your terminal.
- Try testing with `.ping` or simple `ping`.
</details>

<details>
<summary><strong>2. <code>Permanent disconnect (loggedOut)</code> error</strong></summary>

- Your WhatsApp linked device was unlinked from your phone.
- Remove the `auth/` directory: `rm -rf auth/`
- Restart the bot and scan/pair again.
</details>

<details>
<summary><strong>3. Bot cannot kick or delete messages in a group</strong></summary>

- WhatsApp requires the bot's account to be promoted to **Group Admin** to delete messages from other participants or remove members.
</details>

---

## 📄 License

Distributed under the **MIT License**. See [`LICENSE`](LICENSE) for more information.
