LUDILO - ONLINE VERSION (v1.0)
==============================

PUT IT ONLINE PERMANENTLY (recommended): see "HOSTING ON RENDER" at the bottom.
The .bat files below are for playing from your own PC instead.

WHAT YOU NEED (one time)
  1. Node.js - free. Download the "LTS" version from https://nodejs.org and install it
     with the default options.
  2. Unzip this folder somewhere easy, like your Desktop.

PLAY WITH FRIENDS OVER THE INTERNET (Discord night)
  1. Double-click  "2 - Play with friends online.bat"
     - The very first time it installs the free Cloudflare tunnel tool, then asks you to
       close the window and double-click again.
     - If Windows asks "Do you want to allow..." click Allow.
  2. Two windows open. Keep both open while you play.
  3. In the tunnel window, wait for a line with a link like
        https://some-random-words.trycloudflare.com
     Open that link in your browser (Ctrl+click it, or copy-paste).
  4. Type your name and click "Create a room".
  5. Share with your friends any of:
       - the invite link (Copy button), paste it in Discord
       - the QR code (they scan it with a phone camera)
       - the 4-letter room code: they open the same trycloudflare link,
         press Join and type the code
  6. In the lobby, the host (you) picks Classic or Fantasy, sets empty seats to
     "Open for a friend" or "Bot", and presses Start.

  Note: the trycloudflare link is new every time you start it, so share the new one
  each game night. No account is needed for you or your friends.

PLAY ON YOUR OWN COMPUTER OR HOME WI-FI
  Double-click "1 - Play on this computer.bat". It opens http://localhost:3000.
  Phones on the same Wi-Fi can join with the address shown in the window
  (like http://192.168.1.20:3000). If Windows Firewall asks, allow "Private networks".

CONTROLS
  Hold Space  - roll (release to stop the dice)      1 2 3 4 - move that pawn
  F           - switch Move / Bomb (then a number)  E / R   - odds / evens
  Chat is on the left (the - button minimizes it). Bots play on their own.
  Turn timer: the host can set 15/30/60 seconds in the lobby, or Off.

STOPPING
  Close the windows (or press Ctrl+C in them). Rooms disappear when the server stops.

TROUBLESHOOTING
  - "winget is not recognized": install cloudflared manually from
    https://developers.cloudflare.com/tunnel/downloads/
  - Friends see "Room not found": make sure they use the trycloudflare link from
    THIS session, and that both windows are still open.
  - Page looks stuck: refresh it. You keep your seat after a refresh.

HOSTING ON RENDER (free, always the same address)
  1. github.com: create a repository named ludilo and upload ALL files in this folder
     (server.js, package.json, README.txt and the public folder).
  2. render.com: sign up with GitHub > New > Web Service > pick the ludilo repository.
     Runtime: Node   Build command: npm install   Start command: node server.js
     Instance type: Free > Create Web Service.
  3. When it says Live, open the address shown at the top (like https://ludilo.onrender.com).
  Updates: upload changed files to GitHub; Render redeploys by itself in a minute or two.
  Note: the free plan sleeps after 15 minutes without visitors; the first visit then
  takes up to about a minute to wake it.
