filepath: c:\My\Projects\ZynqOs\todo.md
# ZynqOS - Future Roadmap & TODO

## 🎯 CRITICAL FOR Mar 15 DEADLINE

### Support for Python and Bash Based apps
- [ ] Make sure all bash and python based apps can run in ZynqOS

### Terminal App Registry
- [ ] CI/CD pipeline to publish newly installed CLI apps to the global app list
- [ ] Terminal command to list available CLI apps

### Remote CLI Tools on EC2 (TOP PRIORITY - MUST COMPLETE)
- [x] **Remote tool execution via terminal** - curl/wget/nmap/dig/nslookup/traceroute/git/npm/pnpm routed to EC2 runtime
- [x] **Allowlist + user-visible errors** - Return allowed tools/packages in error messages
- [x] **Runtime image with base tools** - curl/wget/nmap/dnsutils/traceroute/git/node/npm/pnpm
- [ ] **Per-user sandboxed installs** - Isolated tool installs and home dirs per user
- [ ] **Security controls** - Allowlist/denylist, network egress rules, quotas, audit logs

### PhantomSurf Browser (TOP PRIORITY - MUST COMPLETE)
- [ ] **Fix and complete PhantomSurf browser** - Make it fully functional with proper web rendering
- [ ] **Add URL navigation bar** - Proper address bar with back/forward controls
- [ ] **Fix iframe sandbox** - Ensure proper isolation and security
- [ ] **Add browser controls** - Refresh, home, bookmark functionality
- [ ] **Handle CORS and iframe restrictions** - Better error handling for blocked content
 
### ZynqChat - add a privacy based chat app where you can message anyone with thier github id if they are on zynqos
- [ ] **Use per user SQLlite** -  database in their own local storage synced  with GitHub for zynqchat to maintain chat history and add a rule to auto clear entries older than 24hrs from the database
- [ ] **Core Messaging**
  - [ ] Account/auth: reuse main ZynqOS auth (no separate auth), session management, device list
    - [x] Default GitHub handle with optional custom handle
  - [ ] 1:1 chats: text, emoji, typing indicators, read receipts (store in Git repo, encrypted at rest)
    - [x] Server-backed send/history (in-memory)
    - [x] Remove dummy chats and use real server history
    - [x] Fix the dropdown position
    - [x] Read receipts (seen)
  - [ ] Delete Chat
  - [ ] Group chats: roles (owner/admin/member), invites, join via link (not urgent)
  - [ ] Message actions: edit, delete, reply, reactions, pin, forward, quote
    - [x] Reply + edit + reactions + pin + delete + quote
    - [ ] Forward
  - [ ] Attachments: images, files, link previews, basic file limits
    - [x] VFS-backed attachments + size limits
    - [x] Server attachment sharing (upload + download)
    - [x] Link previews (server fetch + render)
- [ ] **Presence & Notifications**
  - [x] Online/away/offline status (server events)
  - [ ] Push notifications + in-app toast alerts
  - [ ] Mute per chat + per-user
- [ ] **Search & Organization**
  - [ ] Global search across messages, users, files
  - [ ] Message history paging + jump to date
  - [ ] Starred messages and saved items
- [ ] **Security & Privacy**
  - [ ] Advanced encryption in transit (TLS) and at rest
    - [x] Server-side AES-GCM encryption for chat payloads
  - [x] Encrypt attachment blobs at rest
  - [ ] User blocking/reporting
  - [ ] Data export + account deletion
- [ ] **Admin & Moderation**
  - [ ] Not needed: no content monitoring/moderation queue; no user behavior tracking
- [ ] **Usage Metrics**
  - [ ] Usage metrics (DAU/MAU, message volume)
- [ ] **Reliability & Performance**
  - [ ] Offline caching + resend queue
  - [x] Realtime transport (server SSE)
  - [x] Realtime transport (WS/SSE) + fallback polling
  - [x] Persist server chat data (DB/KV)
  - [x] Clear messages older than 24 hours
  - [ ] Rate limits + spam throttling
- [ ] **Cross-Platform**
  - [ ] Responsive web UI
  - [ ] PWA installable
  - [ ] Desktop-friendly shortcuts
- [ ] **Success Criteria (MVP)**
  - [ ] Stable realtime messaging for 1:1 and groups
  - [ ] Reliable auth + user presence
  - [ ] Search, message actions, and notifications
  - [ ] Attachment support

### Terminal Git Support
- [x] Remote git command routing via terminal
- [ ] Per-user Git containers with credential isolation
- [ ] Git credential injection from ZynqOS OAuth (no stored passwords)

### Security & Production Readiness (HIGHEST PRIORITY)
- [ ] **Fix GitHub sync for binary files** - PDF upload/download broken, files lost after push/pull [Error rendering embedded code Invalid PDF when uploaded using the upload option inside file editor but the import button in the start menu perfectly imports the files to github]
- [x] **CRITICAL: Encrypt session tokens** - ✅ Replaced base64 sessions with encrypted JWT using HS256
- [ ] **Fix GitHub App callback error** - "Resource not accessible by integration" on installation
- [x] **Implement automatic token rotation** - ✅ Google/GitHub tokens with automatic refresh logic
- [ ] **Add secrets management** - Move to Vercel KV or vault for token storage

### Core Functionality Bugs (HIGH PRIORITY)
- [ ] **Fix PDF viewer in file manager** - PDFs showing binary code instead of rendering properly
- [ ] **No checks on uploaded files** - someone uploaded image in the phantom surf load html
- [ ] **Fix Python stop button** - Only works once, becomes unresponsive on second run
- [ ] **Fix Python early halt** - Results in "no output" when stopped
- [ ] **Fix terminal Python -c flag** - Syntax error when running Python code inline
- [ ] **Fix interactive bash** - Loads but exits immediately with code 0
- [ ] **Fix Zynqpad undo** - Ctrl+V paste doesn't undo, partial text deletion on Ctrl+X/C
- [ ] **Fix Zynqpad help screen** - ESC key doesn't close, only window close works
- [ ] **Fix Zynqpad replace** - Single replace deletes text instead of replacing

### User Experience Polish (MEDIUM PRIORITY)
- [ ] **Add click-outside to close StartMenu** - ✅ COMPLETED
- [ ] **Remove Export Files option from StartMenu** - ✅ COMPLETED
- [ ] **Move New Window button next to Import** - ✅ COMPLETED
- [ ] **Session restore** - Reopen last workspace windows on reload
- [ ] **Accessibility audit** - Focus order, keyboard navigation, ARIA roles, high-contrast theme
- [ ] **PWA offline support** - Service worker, app manifest, offline-first caching
- [ ] **Loading states** - Better feedback during WASM loading, sync operations
- [ ] **Error handling** - User-friendly error messages throughout the app
- [ ] **Fix OAuth popup closing** - 
- [x] **Give a push and pull buttons inside the file editor too** - ✅ COMPLETED

---

## ✅ COMPLETED FEATURES (v0.5)

### Core System
- ✅ Virtual File System (IndexedDB with WASI sync)
- ✅ Window Manager (draggable, resizable, tabbed, snap zones)
- ✅ Taskbar (macOS-style floating dock)
- ✅ Start Menu (application launcher with search)
- ✅ Settings Panel (display, storage, security, system, about tabs)
- ✅ Cross-window sync (multi-window support with cursor sync)
- ✅ Session time tracking (active time with idle detection)
- ✅ Custom wallpaper support

### Applications
- ✅ File Browser (full VFS management - create, edit, delete)
- ✅ Zynqpad Text Editor (syntax highlighting for 30+ languages)
- ✅ Terminal (WASI runtime with command history)
- ✅ Python REPL (Pyodide with pip package manager)
- ✅ Calculator (WASM-powered)
- ✅ Wednesday AI Assistant (terminal integration)
- ✅ PhantomSurf Browser
- ✅ App Store (package management)
- ✅ Package Importer (.mapp files)

### WASI & Runtime
- ✅ WASI Terminal with kernel shell
- ✅ WASI Utilities (ls, cat, mkdir, rm, touch)
- ✅ Python VFS integration (open_vfs function)
- ✅ WASM-bindgen support
- ✅ Package execution system

### Cloud & Sync
- ✅ OAuth authentication (Google Drive & GitHub)
- ✅ Provider interface abstraction
- ✅ GitHub private repo storage
- ✅ Google Drive folder sync
- ✅ Server-side token exchange
- ✅ Upload queue system
- ✅ Audit log generation
- ✅ CSRF token validation
- ✅ Rate limiting (20 req/min)
- ✅ Webhook signature verification

### Package Management
- ✅ IndexedDB storage for packages
- ✅ Multi-registry support (Official, ZUR, Community)
- ✅ Package installation from registries
- ✅ Upload custom WASM packages
- ✅ WASM validation & checksums
- ✅ Update management
- ✅ Search & filter system
- ✅ Import/export packages
- ✅ Storage statistics

---

## 📋 POST-LAUNCH FEATURES

### Terminal Enhancements
- [ ] Tab completion improvements
- [ ] Multi-tab terminal UI
- [ ] Background job management
- [ ] More bash tools (nmap, git, htop, curl, nano/vim)
- [ ] Command history persistence

### Applications
- [ ] Expense Tracker
- [ ] Task Tracker (Shadow System)
- [ ] PDF viewer/editor
- [ ] Spreadsheet application
- [ ] Markdown editor with preview
- [ ] Real-time collaborative editing

### System Features
- [ ] Theme customization UI
- [ ] Wallpaper picker
- [ ] Multi-monitor support
- [ ] Task/resource monitor
- [ ] Background task scheduler
- [ ] VFS backup/restore

### Package Management
- [ ] Dependency management
- [ ] Package ratings/reviews
- [ ] Sandboxing for security
- [ ] Deterministic installs with lockfiles
- [ ] Rollback/version pinning
- [ ] Auto-update channels

### Cloud Storage
- [ ] Conflict resolution UI
- [ ] Selective sync
- [ ] End-to-end encryption
- [ ] Quota monitoring
- [ ] Parallel uploads with retry
- [ ] Resumable uploads

### Networking
- [ ] SSH client
- [ ] FTP/SFTP client
- [ ] Network diagnostics
- [ ] Proxy configuration

### Media
- [ ] Audio player
- [ ] Video player
- [ ] Image viewer/editor
- [ ] Screen recording

### Security
- [ ] Multi-user/profile support
- [ ] Per-app capability permissions
- [ ] WASM sandbox hardening
- [ ] Anomaly detection
- [ ] Bluetooth-based locking
- [ ] Security incident alerting

---

*Last updated: February 16, 2026*
*Target launch: February 15, 2026*



# Errors or annoying and persistent bugs

## Storage
- [ ] index-CNg1C4ua.js:38650 Sync error: Error: content is not valid Base64
    at kb.syncToGitHub (index-CNg1C4ua.js:37869:372)
    at async De (index-CNg1C4ua.js:38644:13) - solve this issue for all type of files

## Security Github issues
- [ ] PDF upload/download: Uploaded PDF files are lost (not visible after upload or push/pull). Investigate VFS and sync encoding/decoding for binary files.
- [ ] http://localhost:3000/api?route=auth&action=github_app_callback&installation_id=101288930&setup_action=install - {"error":"Resource not accessible by integration"} - init.ts:66 [Auth] GitHub App callback failed: {"error":"Resource not accessible by integration"}

## Python
- [ ] Early halt using stop results in "no output"
- [ ] Stop only works once and becomes unresponsive for the second time I run the code

## Terminal
- [ ] Bash not working
```
Starting interactive bash shell...
Loading bash from Wasmer registry (this may take a moment)...
Bash shell started. Type "exit" to return to ZynqOS terminal.

Bash exited with code 0
```
- [ ] Terminal python -c not working
```
└$ python -c /home/demo.py
Running Python code...
Traceback (most recent call last):
  File "<exec>", line 43, in <module>
  File "<string>", line 1
    /home/demo.py
    ^
SyntaxError: invalid syntax
```

## Zynqpad
- [ ] Undo doesn't work in many cases like:
  - Ctrl+V paste doesn't get undone
- [ ] Ctrl+X and Ctrl+C when used with Ctrl+A are leaving some of the end chars behind
- [ ] ESC doesn't work on help screen - can't exit the help screen once entered; only way to close it is to close the window itself
- [ ] Replace only for one object doesn't work - instead it deletes the text from its location (though replace all works exactly as intended)
