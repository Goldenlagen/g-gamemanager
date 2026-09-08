'use strict';

// Statistiques ressources par serveur pour le tableau de bord.
//
// Un serveur lancé n'est pas un seul processus : G-GameManager démarre souvent
// un wrapper (cmd.exe / powershell.exe) qui lance ensuite Java (Minecraft) ou
// l'exécutable Ark. Pour une mesure juste, on additionne la RAM et le CPU de
// TOUT l'arbre de processus (le PID racine suivi + tous ses descendants).
//
// Windows-only : une seule requête PowerShell/CIM par rafraîchissement.

const { execFile } = require('child_process');

/**
 * @param {number[]} pids PIDs racines (un par serveur en cours d'exécution)
 * @returns {Promise<Object>} { "<pid>": { ramBytes, cpuPercent } }
 */
function getProcessTreeStats(pids) {
  return new Promise((resolve) => {
    const valid = (pids || []).filter((p) => Number.isInteger(p) && p > 0);
    if (valid.length === 0) return resolve({});

    const script = `
$ErrorActionPreference = 'SilentlyContinue'
$roots = @(${valid.join(',')})
$cpuCount = [Environment]::ProcessorCount

$all = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, WorkingSetSize
$childrenMap = @{}
$wsMap = @{}
foreach ($p in $all) {
  $ppid = [int]$p.ParentProcessId
  if (-not $childrenMap.ContainsKey($ppid)) { $childrenMap[$ppid] = New-Object System.Collections.ArrayList }
  [void]$childrenMap[$ppid].Add([int]$p.ProcessId)
  $wsMap[[int]$p.ProcessId] = [int64]$p.WorkingSetSize
}

function TreePids($root) {
  $result = New-Object System.Collections.ArrayList
  $stack = New-Object System.Collections.Stack
  $stack.Push([int]$root)
  while ($stack.Count -gt 0) {
    $cur = $stack.Pop()
    if ($result.Contains($cur)) { continue }
    [void]$result.Add($cur)
    if ($childrenMap.ContainsKey($cur)) { foreach ($c in $childrenMap[$cur]) { $stack.Push([int]$c) } }
  }
  return $result
}

$trees = @{}
$allPids = New-Object System.Collections.Generic.HashSet[int]
foreach ($r in $roots) {
  $t = TreePids $r
  $trees[$r] = $t
  foreach ($x in $t) { [void]$allPids.Add([int]$x) }
}
$idsArr = @($allPids)

function CpuSnap($ids) {
  $h = @{}
  foreach ($proc in Get-Process -Id $ids -ErrorAction SilentlyContinue) { $h[[int]$proc.Id] = [double]$proc.CPU }
  return $h
}
$c1 = CpuSnap $idsArr
Start-Sleep -Milliseconds 500
$c2 = CpuSnap $idsArr

$out = @{}
foreach ($r in $roots) {
  $ram = [int64]0
  $cpu = [double]0
  foreach ($tp in $trees[$r]) {
    $ram += [int64]$wsMap[[int]$tp]
    $prev = $c1[[int]$tp]; $now = $c2[[int]$tp]
    if ($prev -ne $null -and $now -ne $null) { $cpu += ($now - $prev) }
  }
  $pct = if ($cpu -gt 0) { [math]::Round(($cpu / (0.5 * $cpuCount)) * 100, 1) } else { 0 }
  if ($pct -gt 100) { $pct = 100 }
  $out["$r"] = [PSCustomObject]@{ ramBytes = $ram; cpuPercent = $pct }
}
$out | ConvertTo-Json -Compress -Depth 4
`.trim();

    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, timeout: 8000 },
      (err, stdout) => {
        if (err) return resolve({});
        try {
          const parsed = JSON.parse(stdout);
          resolve(parsed && typeof parsed === 'object' ? parsed : {});
        } catch (e) {
          resolve({});
        }
      }
    );
  });
}

module.exports = { getProcessTreeStats };
