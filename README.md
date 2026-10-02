# Shuriken

AI-powered multi-game mod manager, modpack assembler and mod workshop for Windows, with a free AI assistant that runs on your own PC.

## Download

Go to **[Releases](../../releases/latest)** and download `Shuriken-0.3.1-Windows.zip`. Extract it and open **READ FIRST.txt** for the full setup guide.

Quick start:
1. Run `Shuriken Setup 0.3.1.exe`. Windows SmartScreen may warn about an unsigned app: click **More info → Run anyway**.
2. Shuriken finds your Steam games automatically. Use **Game Library** for everything else.
3. For the free AI: **Settings → AI assistant → Shuriken Local AI**, install [Ollama](https://ollama.com/download) if asked, then click **Download** for the model (about 6 GB, one time).
4. Install mods (drag archives in, or use **Get Mods**), click **Deploy**, then **Play**.

Requirements: Windows 10/11 64-bit. The local AI works best with a 6–8 GB GPU and 16 GB RAM.

## Build from source

```
npm install
node node_modules/electron/install.js   # npm 11+ blocks Electron's download script
npm start                               # run from source
npm run dist                            # dist/Shuriken Setup 0.2.0.exe and dist/Shuriken-Portable-0.2.0.exe
npm run selftest                        # headless checks (fake game folders for install/deploy tests)
```

## Games (38)

- **Bethesda (plugins + load order):** Skyrim SE/LE/VR, Fallout 4/VR, Fallout 3, New Vegas, Oblivion, Starfield. Classic games use timestamp load order and Oblivion's 20-byte record header.
- **Minecraft: Java:** Modrinth search with auto-dependencies, .mrpack import/export, Forge/NeoForge/Fabric installers.
- **Mod-folder games:** Cyberpunk 2077, Witcher 3, Baldur's Gate 3, Elden Ring, Dark Souls III, Stardew Valley, RimWorld, Valheim, Lethal Company, Risk of Rain 2, Subnautica, Bannerlord, Kenshi, 7 Days to Die, Palworld, Hogwarts Legacy, Oblivion Remastered, Monster Hunter World/Rise, Kingdom Come 1/2, The Sims 4, Factorio, Cities: Skylines, Darkest Dungeon, Satisfactory, RDR2, Mass Effect LE (via ME3Tweaks). Each game definition in `src/core/library.js` says where mods go, how archives are laid out, which framework mods need, and where logs are.

## How it works

- **Staging + hardlink deployment** (like Vortex): tools such as xEdit, the Creation Kit and LOOT see deployed mods without a virtual file system. Purge restores the original files.
- **Profiles** keep separate enabled sets, priorities and load orders. **FOMOD** installers get a wizard.
- **AI assistant** (Claude, your own API key) reads mod lists, load orders, plugin headers, archives, INIs, crash logs and screenshots. It also drives tools:
  - **xEdit:** cleaning and generated scripts.
  - **Creation Kit:** precombines/previs and the Papyrus compiler.
  - **Archives:** packing and unpacking with BSArch and Archive2.
  - **LOOT:** sorting and masterlist notes.
  - **BodySlide:** batch builds.
  - **Fallout 4 archive checks:** the same BA2 checks as CM Toolkit.
  - **NIF texture checks.**
  - **WorldPainter:** generated worlds from heightmaps.
  - **Any registered tool** with a command line.

  Every change asks for approval unless Auto-fix is on, and edited files are backed up as `*.shuriken.bak`.
- **Workshop:** the AI builds mods from a prompt:
  - Bethesda mods: plugins through xEdit scripts, Papyrus, config-framework INIs and archives.
  - Minecraft: datapacks, resource packs, KubeJS/config packs, and real Fabric mods built with Gradle. A portable Java is downloaded automatically when a build needs a newer one.
  - Mod files for other games.

xEdit automation: read-only scripts run unattended. Scripts that write plugins may need the user to confirm in the xEdit window.

Data lives in `%APPDATA%\ModForge` (kept from before the rename) or `%APPDATA%\Shuriken` on new installs.
