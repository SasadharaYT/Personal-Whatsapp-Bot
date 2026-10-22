# 🤖 WhatsApp Bot

<p align="center">
  <img src="https://raw.githubusercontent.com/WhiskeySockets/Baileys/master/media/logo.png" alt="Baileys Logo" width="100"/>
</p>

<p align="center">
  A secure, feature-rich, production-ready WhatsApp bot built with <strong>Node.js (ESM)</strong>, <strong>@whiskeysockets/baileys v7.0.0-rc14</strong>, <strong>Ollama Cloud Gemma AI</strong>, <strong>yt-dlp Media Downloader</strong>, and <strong>Pexels Image Engine</strong>.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg" alt="Node Version"/>
  <img src="https://img.shields.io/badge/baileys-7.0.0--rc14-blue.svg" alt="Baileys Version"/>
  <img src="https://img.shields.io/badge/tests-128%20passed-success.svg" alt="Tests"/>
  <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License"/>
</p>

> ⚠️ **Disclaimer:** This project uses the unofficial WhatsApp Web API. Automation tools may result in account restrictions or bans if abused. Use responsibly and at your own risk.

---

## 📑 Table of Contents

- [✨ Features](#-features)
- [⚡ Quick Start](#-quick-start)
- [🪟 Windows Setup Guide (yt-dlp & ffmpeg)](#-windows-setup-guide-yt-dlp--ffmpeg)
- [📱 Pairing with WhatsApp](#-pairing-with-whatsapp)
- [⚙️ Configuration (`.env`)](#️-configuration-env)
- [🎮 Commands Guide](#-commands-guide)
  - [1. General Commands](#1-general-commands-everyone)
  - [2. Ollama Cloud AI Commands](#2-ollama-cloud-ai-commands)
  - [3. YouTube Media Commands](#3-youtube-media-commands)
  - [4. Image & Wallpaper Commands](#4-image--wallpaper-commands)
  - [5. System & Health Commands](#5-system--health-commands)
  - [6. Group Commands](#6-group-commands-group-admins)
  - [7. Admin Moderation](#7-admin-moderation-group-admins)
  - [8. Owner Commands](#8-owner-commands-bot-owner)
- [🛡️ Security & Safety Controls](#️-security--safety-controls)
- [🧪 Testing & Scripts](#-testing--scripts)
- [🚢 Production Deployment](#-production-deployment)
- [❓ Troubleshooting](#-troubleshooting)

---

## ✨ Features

- 🧠 **Ollama Cloud Gemma AI:** Intelligent conversations using `gemma4:31b-cloud` with multi-turn context, summarization, translation, topic explanation, and per-user privacy.
- 🎬 **YouTube Media Downloader:** Download MP4 videos and MP3 audio tracks via controlled `yt-dlp` subprocess with job queuing, size caps, and automatic temporary file cleanup.
- 🖼️ **Pexels Wallpaper & Image Search:** Instant phone wallpapers (portrait) and high-resolution photo searches with photographer attribution and magic-byte verification.
- 🔐 **Secure & Private:** Multi-device auth session (`auth/`), temporary files (`temp/`), and keys (`.env`) are strictly git-ignored.
- 🛡️ **SSRF & Input Safety:** Strict URL validation, private IP blocking (RFC 1918 / localhost / cloud metadata), file magic-byte inspection, and disk quota enforcement.
- ⏱️ **Token-Bucket Rate Limiter:** Per-user and per-group burst/replenish rate limiting across AI, media downloads, and image searches.
- ⚡ **Multi-Prefix & Prefix-less:** Supports `.`, `!`, `/`, and `#`, plus direct prefix-less commands in private chats.
- 👥 **Group Moderation:** Anti-link protection, warning strikes, kick/promote/demote, member tagging, and welcome/goodbye greetings.
- 👑 **Role-Based Access Control:** Live permissions fetched directly from WhatsApp metadata to prevent stale privilege escalation.
- 💾 **Atomic Database:** Zero-dependency file-based storage with atomic writes to eliminate race conditions.

---

## ⚡ Quick Start

### 1. Prerequisites
- **Node.js** `>= 20.0.0`
- **npm** `>= 9.0.0`
- A smartphone with WhatsApp installed
- *(Optional for media features)* **yt-dlp** and **ffmpeg** (see [Windows Setup Guide](#-windows-setup-guide-yt-dlp--ffmpeg))

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

### 3. Configure Your Environment
Open `.env` and configure your phone number and API keys:

```dotenv
OWNER_NUMBERS=94710504147
OLLAMA_API_KEY=your_ollama_api_key_here
OLLAMA_MODEL=gemma4:31b-cloud
PEXELS_API_KEY=your_pexels_api_key_here
```

### 4. Start the Bot

```bash
npm start
```

---

## 🪟 Windows Setup Guide (yt-dlp & ffmpeg)

For YouTube downloads (`.ytmp4`, `.ytmp3`, `.ytinfo`), the bot runs `yt-dlp` and `ffmpeg` directly on your Windows laptop.

### Easy Installation via winget (Windows Package Manager)

Open **PowerShell** or **Command Prompt** as Administrator:

```powershell
# Install yt-dlp
winget install yt-dlp.yt-dlp

# Install ffmpeg
winget install Gyan.FFmpeg
```

### Alternative Installation via Chocolatey

```powershell
choco install yt-dlp ffmpeg -y
```

### Verify Installation
After installing, close and reopen your terminal, then verify:

```powershell
where yt-dlp
where ffmpeg
```

If both commands return executable paths, the bot will automatically detect and use them!

---

## 📱 Pairing with WhatsApp

### Option A: QR Code (Terminal)
1. In `.env`, ensure `USE_PAIRING_CODE=false`.
2. Run `npm start`.
3. Open WhatsApp on your phone:
   - **Settings** > **Linked Devices** > **Link a Device**.
4. Scan the QR code printed in your terminal.

### Option B: 8-Digit Pairing Code (Recommended)
1. In `.env`, configure:
   ```dotenv
   USE_PAIRING_CODE=true
   PAIRING_PHONE_NUMBER=94710504147
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
| `OLLAMA_API_KEY` | Recommended | — | Ollama Cloud API key from [Ollama settings](https://ollama.com/settings/keys) |
| `OLLAMA_MODEL` | No | `gemma4:31b-cloud` | Ollama Cloud model name |
| `AI_ENABLED` | No | `true` | Global enable/disable switch for AI commands |
| `PEXELS_API_KEY` | Recommended | — | Free image API key from [Pexels](https://www.pexels.com/api/) |
| `MEDIA_ENABLED` | No | `true` | Global enable/disable switch for media downloads |
| `MAX_MEDIA_SIZE_MB` | No | `50` | Maximum media file download size in MB |
| `MAX_CONCURRENT_DOWNLOADS` | No | `2` | Maximum concurrent video downloads |
| `TEMP_DIR` | No | `temp` | Directory for in-flight media downloads |

---

## 🎮 Commands Guide

### 1. General Commands (Everyone)
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

### 2. Ollama Cloud AI Commands
Powered by Gemma 4 31B through Ollama Cloud. Supports conversational context, quoted message inputs, and automatic safety filtration.

| Command | Aliases | Description |
|---|---|---|
| `.ai <prompt>` | `ask`, `gemini`, `chat` | Chat with Gemma (conversation history is preserved) |
| `.summarize [text]` | `summary`, `sum` | Summarise provided text or a quoted message |
| `.translate <lang> [text]` | `tr` | Translate text or a quoted message to any language |
| `.explain <topic>` | `eli5` | Explain a concept in simple, accessible language |
| `.clearai` | `resetai`, `forget` | Reset your AI conversation history |
| `.aistatus` | `geministatus` | View Ollama Cloud status, model, and active sessions |
| `.aihelp` | — | Guide and examples for AI commands |

---

### 3. YouTube Media Commands
Downloads YouTube media safely via `yt-dlp` subprocess.

| Command | Aliases | Description |
|---|---|---|
| `.ytinfo <url>` | `yinfo`, `videoinfo` | Fetch YouTube video metadata, length, views, and uploader |
| `.ytmp4 <url>` | `ytvideo`, `ytdl` | Download YouTube video as MP4 (up to 50MB) |
| `.ytmp3 <url>` | `ytaudio`, `yta` | Download audio track as MP3 (up to 50MB) |
| `.ythelp` | `mediahelp` | Usage rules and limits for media downloads |

---

### 4. Image & Wallpaper Commands
High-resolution photos and phone wallpapers via Pexels with photographer credit.

| Command | Aliases | Description |
|---|---|---|
| `.wallpaper [category]` | `wp`, `wall` | Search portrait phone wallpapers (e.g. `.wallpaper anime`, `.wallpaper nature`) |
| `.image <query>` | `img`, `pic` | Search general high-resolution photos |
| `.imageinfo` | `curated` | Fetch a random curated photo with photographer credit |
| `.imagehelp` | `wallpaperhelp` | View popular wallpaper categories and search tips |

---

### 5. System & Health Commands
Diagnostics, queue inspection, and feature switches.

| Command | Aliases | Permission | Description |
|---|---|:---:|---|
| `.health` | `syshealth`, `sys` | Everyone | System dashboard: memory, disk space, AI status, yt-dlp, ffmpeg |
| `.mediaqueue` | `queue`, `jobs` | Everyone | View active media downloads and queue progress |
| `.cancelmedia <id>` | `canceljob` | User / Admin | Cancel an in-progress download job |
| `.toggleai on\|off\|status` | — | Admin / Owner | Enable or disable AI commands in this group |
| `.togglemedia on\|off\|status` | — | Bot Owner | Enable or disable media downloading globally |

---

### 6. Group Commands (Group Admins)
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

### 7. Admin Moderation (Group Admins)
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

### 8. Owner Commands (Bot Owner)
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

## 🛡️ Security & Safety Controls

- **SSRF Protection:** Validates URLs against private IP ranges (RFC 1918, `localhost`, loopbacks, cloud metadata `169.254.169.254`).
- **Controlled Subprocess Spawning:** `yt-dlp` runs using `child_process.spawn` with `shell: false` and fixed arguments, preventing command-injection attacks.
- **File Magic-Byte Inspection:** Verifies downloaded files match expected binary signatures (JPEG, PNG, WebP, MP4, MP3) prior to saving or sending.
- **Disk Space Safeguards:** Checks partition free space before allowing new downloads (requires ≥ 500MB free).
- **Automatic Temp Cleanup:** Downloads are stored in `temp/` with unguessable random names and deleted immediately in `finally` blocks on success, failure, or cancellation.
- **Prompt Isolation:** AI system prompts are strictly isolated in service logic and never returned to users.
- **Rate Limiting:** Token-bucket rate limiters prevent API quota exhaustion or denial of service across AI, downloads, and image searches.

---

## 🧪 Testing & Scripts

| Command | Purpose |
|---|---|
| `npm start` | Run bot in production mode |
| `npm run dev` | Run with file watcher (`--watch`) for development |
| `npm test` | Run complete 128-test Jest suite (mocked socket & APIs) |
| `npm run check` | Run static Node syntax analysis across all 23 source files |

---

## 🚢 Production Deployment

### Windows Deployment (Service via PM2 or Task Scheduler)

```powershell
# Install PM2 globally
npm install -g pm2

# Start the bot under PM2
pm2 start src/index.js --name "whatsapp-bot"

# Save configuration
pm2 save
```

### Linux Deployment (Systemd)
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

---

## ❓ Troubleshooting

<details>
<summary><strong>1. Bot does not respond to my messages</strong></summary>

- Verify your phone number in `.env` is formatted with country code and digits only (e.g. `94710504147`, not `+94 71 050 4147`).
- Check that the process is running in your terminal.
- Try testing with `.ping` or simple `ping`.
</details>

<details>
<summary><strong>2. <code>Permanent disconnect (loggedOut)</code> error</strong></summary>

- Your WhatsApp linked device was unlinked from your phone.
- Remove the `auth/` directory: `rm -rf auth/`
- Restart the bot and scan/pair again.
</details>

<details>
<summary><strong>3. YouTube downloads report "yt-dlp is not installed"</strong></summary>

- Run `winget install yt-dlp.yt-dlp` in PowerShell (Admin).
- Verify with `where yt-dlp`.
- Restart your terminal and bot process.
</details>

<details>
<summary><strong>4. Ollama Cloud AI reports "API key is not configured"</strong></summary>

- Obtain a free API key at [Google AI Studio](https://aistudio.google.com/).
- Set `OLLAMA_API_KEY=your_key` in `.env`.
- Restart the bot.
</details>

---

## 📄 License

Distributed under the **MIT License**. See [`LICENSE`](LICENSE) for more information.
