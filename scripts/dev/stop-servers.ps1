<#
.SYNOPSIS
    Stop the local GridGrove dev servers.

.DESCRIPTION
    Finds whatever is listening on the dev ports (3001 for the backend, 3000
    for the React dev server) and stops it, together with the supervisor that
    launched it - nodemon for the backend, react-scripts for the frontend.

    Processes are found by PORT, not by name, so this only ever touches the
    servers for this project - another Node project running in a second
    terminal is left alone. That matters more than it sounds: "stop every node
    process" is the obvious way to write this, and it also kills whatever else
    the machine happens to be running.

    The supervisor is stopped BEFORE the server under it, because nodemon
    exists precisely to restart a child that dies; killing the leaf first just
    gets it started again.

    Under "npm run dev" the ancestry is node -> cmd.exe -> node, since npm runs
    through .cmd shims, so the walk up stops at the first shim and reaches only
    the supervisor. That is enough: concurrently and the npm wrappers above it
    exit on their own once the processes they were waiting on are gone. Ports
    are re-checked at the end, so anything that did not cascade is reported
    rather than assumed dead.

.PARAMETER Ports
    Ports to clear. Defaults to the two the dev setup uses.

.PARAMETER DryRun
    List what would be stopped, without stopping it.

.EXAMPLE
    npm run stop

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\dev\stop-servers.ps1

.EXAMPLE
    # See what would be stopped, without stopping it:
    powershell -ExecutionPolicy Bypass -File scripts\dev\stop-servers.ps1 -DryRun

.EXAMPLE
    # Clear an extra port too (say the auth server on 4000):
    powershell -ExecutionPolicy Bypass -File scripts\dev\stop-servers.ps1 -Ports 3000,3001,4000
#>
[CmdletBinding()]
param(
    [int[]]$Ports = @(3000, 3001),

    # A plain switch rather than the usual -WhatIf: SupportsShouldProcess does
    # not bind reliably when the script is dot-sourced or invoked through a
    # wrapper, and a dry run that silently stops things instead would be worse
    # than having no dry run at all.
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

# A wrapper is a node process that exists to run another one. These are worth
# stopping alongside the server; anything else in the ancestry (the terminal,
# VS Code, explorer) is not ours to touch.
$wrapperPatterns = @(
    'npm-cli\.js',
    'npx-cli\.js',
    'concurrently',
    'nodemon',
    'react-scripts'
)

function Get-ProcessInfo {
    param([int]$ProcessId)
    try {
        Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction Stop
    } catch {
        $null
    }
}

function Get-ShortCommand {
    param($Process)
    if (-not $Process) { return '(gone)' }
    $line = $Process.CommandLine
    if (-not $line) { return $Process.Name }
    if ($line.Length -gt 100) { return $line.Substring(0, 100) + '...' }
    return $line
}

# --- find the listeners -----------------------------------------------------

# ProcessId -> reason, in the order they should be stopped. Keys are strings
# on purpose: an OrderedDictionary indexed by an integer looks the entry up by
# POSITION rather than by key, so integer process ids silently address the
# wrong slot and then run off the end of the collection.
$targets = [ordered]@{}

foreach ($port in $Ports) {
    $owners = @()
    try {
        $owners = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction Stop |
                  Select-Object -ExpandProperty OwningProcess -Unique
    } catch {
        # Nothing listening on this port, which is the normal case for a port
        # that was already stopped.
        continue
    }

    foreach ($ownerId in $owners) {
        $owner = Get-ProcessInfo -ProcessId $ownerId
        if (-not $owner) { continue }

        # Walk up the ancestry collecting the wrappers that launched it. Bounded
        # so a strange parent chain cannot send this climbing to the desktop.
        $chain = @()
        $current = $owner
        for ($depth = 0; $depth -lt 5; $depth++) {
            $parent = Get-ProcessInfo -ProcessId $current.ParentProcessId
            if (-not $parent -or $parent.Name -ne 'node.exe') { break }

            $parentLine = if ($parent.CommandLine) { $parent.CommandLine } else { '' }
            $isWrapper = $false
            foreach ($pattern in $wrapperPatterns) {
                if ($parentLine -match $pattern) { $isWrapper = $true; break }
            }
            if (-not $isWrapper) { break }

            $chain += $parent
            $current = $parent
        }

        # Outermost wrapper first, then inwards, then the server itself - so a
        # supervisor is gone before the process it would otherwise restart.
        [array]::Reverse($chain)
        foreach ($link in $chain) {
            $key = [string]$link.ProcessId
            if (-not $targets.Contains($key)) {
                $targets[$key] = "wrapper for port $port"
            }
        }
        $ownerKey = [string]$owner.ProcessId
        if (-not $targets.Contains($ownerKey)) {
            $targets[$ownerKey] = "listening on port $port"
        }
    }
}

# --- stop them --------------------------------------------------------------

if ($targets.Count -eq 0) {
    Write-Host "Nothing listening on port(s) $($Ports -join ', ') - the dev servers are already stopped." -ForegroundColor Yellow
    return
}

$stopped = 0
foreach ($entry in $targets.GetEnumerator()) {
    $procId = [int]$entry.Key
    $proc = Get-ProcessInfo -ProcessId $procId
    if (-not $proc) { continue }   # a parent may have taken this one with it

    $description = "PID $procId ($($entry.Value)): $(Get-ShortCommand $proc)"

    if ($DryRun) {
        Write-Host "  would stop  $description" -ForegroundColor Cyan
        continue
    }

    try {
        Stop-Process -Id $procId -Force -ErrorAction Stop
        Write-Host "  stopped  $description" -ForegroundColor Green
        $stopped++
    } catch {
        Write-Host "  could not stop $description - $($_.Exception.Message)" -ForegroundColor Red
    }
}

if ($DryRun) {
    Write-Host "Dry run - nothing was stopped. Run without -DryRun to stop them." -ForegroundColor Cyan
    return
}

if ($stopped -gt 0) {
    # Give the sockets a moment to come down before anyone starts them again.
    Start-Sleep -Milliseconds 400
    $stillUp = @()
    foreach ($port in $Ports) {
        try {
            $null = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction Stop
            $stillUp += $port
        } catch { }
    }
    if ($stillUp.Count -gt 0) {
        Write-Host "Port(s) $($stillUp -join ', ') are still in use. Run this again, or check for a server started outside this project." -ForegroundColor Yellow
    } else {
        Write-Host "Dev servers stopped; port(s) $($Ports -join ', ') are free." -ForegroundColor Green
    }
}
