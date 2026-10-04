# shuriken-vfs

Small launcher Shuriken uses for **Virtual mode** (Mod Organizer 2 style). It loads
[usvfs](https://github.com/ModOrganizer2/usvfs), the user-space virtual file system made for MO2,
maps each enabled mod onto the game folder virtually, and starts the game or tool inside that view.

- License: **GPL-3.0-or-later** (see `LICENSE`), because it loads usvfs (GPL-3.0). The rest of
  Shuriken is MIT; Shuriken only runs this program as a separate process.
- usvfs itself is not bundled: Shuriken downloads it from MO2's official GitHub release on first use.

Build (no SDK needed, uses the C# compiler that ships with Windows):

```
C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe -nologo -optimize+ -platform:x64 -target:exe -out:..\src\core\bin\shuriken-vfs.exe ShurikenVfs.cs
```
