# Installs or updates Browser Helper Lite for Chrome on Windows:
#
#   irm https://raw.githubusercontent.com/ethanzhrepo/browser-helper-lite/main/scripts/install.ps1 | iex
#
# It downloads the latest release from GitHub, checks the file against the
# SHA-256 that GitHub publishes for it, and unpacks it into a folder in your
# home directory. Chrome installs extensions by itself only from the Chrome Web
# Store, so the last step is yours: "Load unpacked" in chrome://extensions.
# Run it again to update; the folder stays the same, so your settings do too.
#
# Options (environment variables):
#   BHL_DIR      where to put the extension (default: ~\browser-helper-lite-extension)
#   BHL_VERSION  the release to install, e.g. 0.1.0 (default: the latest)
#   BHL_NO_OPEN  set to 1 to leave Chrome and the clipboard alone

& {
  $ErrorActionPreference = 'Stop'
  # Windows PowerShell 5.1 downloads many times slower while it draws its progress bar.
  $ProgressPreference = 'SilentlyContinue'
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

  $repo = 'ethanzhrepo/browser-helper-lite'
  $marker = '.installed-by-browser-helper-lite'
  $headers = @{ 'User-Agent' = 'browser-helper-lite-installer'; 'Accept' = 'application/vnd.github+json' }
  $dir = if ($env:BHL_DIR) { $env:BHL_DIR } else { Join-Path $HOME 'browser-helper-lite-extension' }
  $dir = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($dir)
  $version = if ($env:BHL_VERSION) { $env:BHL_VERSION -replace '^v', '' } else { '' }
  $quiet = $env:BHL_NO_OPEN -eq '1'

  # Never replace a folder this installer did not create.
  if ((Test-Path -LiteralPath $dir) -and -not (Test-Path -LiteralPath (Join-Path $dir $marker))) {
    $isFolder = Test-Path -LiteralPath $dir -PathType Container
    if (-not $isFolder -or (Get-ChildItem -LiteralPath $dir -Force | Select-Object -First 1)) {
      throw "$dir already exists and was not created by this installer. Move it away, or set BHL_DIR to another folder."
    }
  }

  $label = if ($version) { $version } else { 'latest' }
  Write-Host "Looking up the $label release of Browser Helper Lite..."
  $api = if ($version) { "https://api.github.com/repos/$repo/releases/tags/v$version" } else { "https://api.github.com/repos/$repo/releases/latest" }
  $url = $null
  $digest = $null
  try {
    $release = Invoke-RestMethod -Uri $api -Headers $headers
    $asset = $release.assets | Where-Object { $_.name -like '*-chrome.zip' } | Select-Object -First 1
    if ($asset) {
      $url = [string]$asset.browser_download_url
      if ([string]$asset.digest -like 'sha256:*') { $digest = ([string]$asset.digest).Substring(7).ToLower() }
    }
  } catch {
    # GitHub's API allows a limited number of requests per address; the release pages do not.
  }
  if (-not $url) {
    if (-not $version) {
      $page = Invoke-WebRequest -Uri "https://github.com/$repo/releases/latest" -UseBasicParsing -Headers @{ 'User-Agent' = $headers['User-Agent'] }
      $base = $page.BaseResponse
      $final = if ($base.ResponseUri) { $base.ResponseUri.AbsoluteUri } else { $base.RequestMessage.RequestUri.AbsoluteUri }
      $version = ($final -split '/v')[-1]
    }
    if ($version -notmatch '^[0-9A-Za-z.-]+$') { throw "Could not find the release. Download it from https://github.com/$repo/releases" }
    $url = "https://github.com/$repo/releases/download/v$version/browser-helper-lite-$version-chrome.zip"
  }
  if (-not $url.StartsWith("https://github.com/$repo/releases/download/")) { throw "Unexpected download address: $url" }

  $parent = Split-Path -Parent $dir
  if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
  # Unpacked next to its final place, so swapping it in is a rename on the same disk.
  $staging = "$dir." + [Guid]::NewGuid().ToString('N').Substring(0, 8)
  New-Item -ItemType Directory -Path $staging | Out-Null
  try {
    $zip = Join-Path $staging 'extension.zip'
    Write-Host "Downloading $(Split-Path -Leaf $url)..."
    Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing -Headers @{ 'User-Agent' = $headers['User-Agent'] }

    if ($digest) {
      $actual = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLower()
      if ($actual -ne $digest) { throw "The download does not match the checksum GitHub lists (expected $digest, got $actual). Nothing was installed." }
      Write-Host "Checksum OK (sha256 $actual)."
    } else {
      Write-Host "Note: GitHub's API could not be reached, so the download's checksum was not checked."
    }

    $new = Join-Path $staging 'new'
    Expand-Archive -LiteralPath $zip -DestinationPath $new
    $manifest = Join-Path $new 'manifest.json'
    if (-not (Test-Path -LiteralPath $manifest)) { throw 'The download does not look like the extension (no manifest.json).' }
    $installed = [string](Get-Content -Raw -LiteralPath $manifest | ConvertFrom-Json).version
    Set-Content -LiteralPath (Join-Path $new $marker) -Value $installed

    $updating = Test-Path -LiteralPath (Join-Path $dir $marker)
    if (Test-Path -LiteralPath $dir) { Move-Item -LiteralPath $dir -Destination (Join-Path $staging 'old') }
    Move-Item -LiteralPath $new -Destination $dir
  } finally {
    Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
  }

  Write-Host ''
  if ($updating) {
    Write-Host "Updated Browser Helper Lite to $installed in:"
    Write-Host "  $dir"
    Write-Host ''
    Write-Host 'To finish: open chrome://extensions and click the reload button on the Browser Helper Lite card.'
  } else {
    $copied = $false
    if (-not $quiet) {
      try { Set-Clipboard -Value $dir; $copied = $true } catch { }
    }
    Write-Host "Browser Helper Lite $installed is unpacked in:"
    Write-Host "  $dir"
    Write-Host ''
    Write-Host 'To finish, in Chrome:'
    Write-Host '  1. Open chrome://extensions and turn on "Developer mode" (top right).'
    Write-Host '  2. Click "Load unpacked" and choose the folder above.'
    if ($copied) { Write-Host '     Its path is on your clipboard: paste it into the folder box of the dialog.' }
    Write-Host "  3. Click the extension's toolbar icon to open the side panel, then add a model connection in Settings."
    Write-Host ''
    Write-Host 'Keep the folder: Chrome loads the extension from it. Run this command again to update.'
  }

  if (-not $quiet) {
    try { Start-Process 'chrome' 'chrome://extensions' } catch { }
  }
}
