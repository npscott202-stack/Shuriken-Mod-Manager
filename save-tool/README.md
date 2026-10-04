# Shuriken save tool

`src/core/bin/shuriken-savetool.jar` is the ReSaver save engine from
[FallrimTools](https://github.com/mdfairch/FallrimTools) by Mark Fairchild (Apache License 2.0,
see `src/core/bin/shuriken-savetool.LICENSE.txt`) plus a small command-line front end,
`src/resaver/ShurikenSaveTool.java`, so Shuriken can check and clean Skyrim (LE/SE/VR) and
Fallout 4 saves without the ReSaver window.

```
java -jar shuriken-savetool.jar info  <save>
java -jar shuriken-savetool.jar clean <save> <out> [unattached] [undefined] [nonexistent] [formlists] [havok]
```

Both print one line of JSON. `clean` reads its output back before reporting success.

## Rebuilding

1. Get the FallrimTools source and fetch its dependencies:
   `mvn dependency:copy-dependencies -DoutputDirectory=deps -DincludeScope=runtime`
2. `powershell -File save-tool\build.ps1 -FallrimTools <source folder> -Jdk <JDK 17+ home>`
