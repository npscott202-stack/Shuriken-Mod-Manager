# Builds src/core/bin/shuriken-savetool.jar from FallrimTools (ReSaver) + ShurikenSaveTool.java.
# Usage: powershell -File save-tool\build.ps1 -FallrimTools <path to FallrimTools source> -Jdk <JDK home>
param([Parameter(Mandatory)] [string]$FallrimTools, [Parameter(Mandatory)] [string]$Jdk)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $FallrimTools 'src\main\java'
$deps = Join-Path $FallrimTools 'deps'   # filled by: mvn dependency:copy-dependencies -DoutputDirectory=deps
$build = Join-Path $env:TEMP 'shuriken-savetool-build'
if (Test-Path $build) { Remove-Item -LiteralPath $build -Recurse -Force }
New-Item -ItemType Directory -Force $build | Out-Null
Copy-Item (Join-Path $PSScriptRoot 'src\resaver\ShurikenSaveTool.java') (Join-Path $src 'resaver\ShurikenSaveTool.java') -Force
$cp = (Get-ChildItem $deps -Filter *.jar | ForEach-Object FullName) -join ';'
$files = Get-ChildItem $src -Recurse -Filter *.java | ForEach-Object FullName
$list = Join-Path $build 'sources.txt'
$files | ForEach-Object { '"' + ($_ -replace '\\', '/') + '"' } | Set-Content -Encoding ascii $list
$classes = Join-Path $build 'classes'
& "$Jdk\bin\javac.exe" -nowarn -encoding UTF-8 --release 17 -d $classes -cp $cp "@$list"
if ($LASTEXITCODE -ne 0) { throw 'javac failed' }
Copy-Item (Join-Path $FallrimTools 'src\main\resources\*') $classes -Recurse -Force
# Fat jar: unpack the small runtime dependencies (not JavaFX, which only the ReSaver GUI uses).
Push-Location $classes
foreach ($j in Get-ChildItem $deps -Filter *.jar | Where-Object { $_.Name -notmatch '^javafx|^junit|^annotations' }) { & "$Jdk\bin\jar.exe" xf $j.FullName }
Remove-Item -Recurse -Force META-INF -ErrorAction SilentlyContinue
Pop-Location
$out = Join-Path $root 'src\core\bin\shuriken-savetool.jar'
& "$Jdk\bin\jar.exe" --create --file $out --main-class resaver.ShurikenSaveTool -C $classes .
if ($LASTEXITCODE -ne 0) { throw 'jar failed' }
Copy-Item (Join-Path $FallrimTools 'LICENSE') (Join-Path $root 'src\core\bin\shuriken-savetool.LICENSE.txt') -Force
Get-Item $out | Select-Object Name, Length
