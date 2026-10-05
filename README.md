# Shuriken

AI-powered multi-game mod manager, modpack assembler and mod workshop for Windows, with a free AI assistant that runs on your own PC.

## Download

Go to **[Releases](../../releases/latest)** and download `Shuriken-0.6.1-Windows.zip`. Extract it and open **READ FIRST.txt** for the full setup guide.

Quick start:
1. Run `Shuriken Setup 0.6.1.exe`. Windows SmartScreen may warn about an unsigned app: click **More info → Run anyway**.
2. Shuriken finds your Steam games automatically. Use **Game Library** for everything else.
3. The free AI is already inside the installer: the llama.cpp engine (Vulkan) plus the Qwen3-VL 2B model, so the assistant works offline straight away with no account or API key. Bigger models (Qwen3-VL 4B/8B) are one-click optional downloads in **Settings → AI assistant**. The portable exe stays small and downloads the AI on first use.
4. Install mods (drag archives in, or use **Get Mods**), click **Deploy**, then **Play**.

Requirements: Windows 10/11 64-bit. The built-in AI works best with a 4–8 GB NVIDIA, AMD or Intel GPU and 16 GB RAM (it also runs on the CPU, slower).

## Build from source

```
npm install
node node_modules/electron/install.js   # npm 11+ blocks Electron's download script
npm start                               # run from source
npm run dist                            # dist/Shuriken Setup <version>.exe and dist/Shuriken-Portable-<version>.exe
npm run selftest                        # headless checks (fake game folders for install/deploy tests)
```

## Games (38)

- **Bethesda (plugins + load order):** Skyrim SE/LE/VR, Fallout 4/VR, Fallout 3, New Vegas, Oblivion, Starfield. Classic games use timestamp load order and Oblivion's 20-byte record header.
- **Minecraft: Java:** Modrinth search with auto-dependencies, .mrpack import/export, Forge/NeoForge/Fabric installers.
- **Mod-folder games:** Cyberpunk 2077, Witcher 3, Baldur's Gate 3, Elden Ring, Dark Souls III, Stardew Valley, RimWorld, Valheim, Lethal Company, Risk of Rain 2, Subnautica, Bannerlord, Kenshi, 7 Days to Die, Palworld, Hogwarts Legacy, Oblivion Remastered, Monster Hunter World/Rise, Kingdom Come 1/2, The Sims 4, Factorio, Cities: Skylines, Darkest Dungeon, Satisfactory, RDR2, Mass Effect LE (via ME3Tweaks). Each game definition in `src/core/library.js` says where mods go, how archives are laid out, which framework mods need, and where logs are.

## How it works

- **Staging + hardlink deployment** (like Vortex): tools such as xEdit, the Creation Kit and LOOT see deployed mods without a virtual file system. Purge restores the original files.
- **Profiles** keep separate enabled sets, priorities and load orders; **instances** are fully separate mod setups per game (like MO2 instances). **FOMOD** installers get a wizard.
- **Virtual mode (MO2-style)**, per game: the game folder stays untouched and mods are layered in at launch through [usvfs](https://github.com/ModOrganizer2/usvfs), the virtual file system Mod Organizer 2 uses (downloaded on first use). Per-profile `plugins.txt`, INIs and saves; new files go to Overwrite. Script extender loaders/ENB/DLL proxies are placed in the game folder automatically (what MO2's Root Builder does). The launcher in `vfs-helper/` is GPL-3.0 because it loads usvfs.
- **Saves tab** (Bethesda games): screenshots, character info, missing plugins, corrupt/leftover file cleanup, backups and restore. Skyrim and Fallout 4 saves get a deep check and cleaning (orphaned/undefined scripts and stuck threads from removed mods) through the ReSaver engine from [FallrimTools](https://github.com/mdfairch/FallrimTools) (Apache-2.0), bundled as `src/core/bin/shuriken-savetool.jar` (source of the small CLI front end in `save-tool/`).
- **Precombines & previs** (Fallout 4): scans the load order for mods that break precombined meshes/previs, cells that lost them and previs patches overridden by older data; detects PRP and applies safe load-order fixes.
- **Playtest mode**: the AI launches the game, loads a save or travels to a place (Bethesda console), takes screenshots, moves the camera, inspects objects and reads console output, then fixes what it finds; you can keep messaging it while it plays. Input and capture go through `src/core/bin/shuriken-input.exe` (source: `vfs-helper/ShurikenInput.cs`, MIT).
- **Tool downloads**: free tools (xEdit, LOOT, Wrye Bash, NifSkope, texconv, Blockbench, AssetRipper, UABEA, FModel, dnSpyEx) install from their official GitHub releases; the AI can install them or ask the user for others.
- **AI assistant**: the built-in Shuriken AI engine (free, on your PC), or Claude with your own API key. It reads mod lists, load orders, plugin headers, archives, INIs, crash logs and screenshots. It also drives tools:
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
