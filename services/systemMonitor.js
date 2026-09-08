'use strict';

const os = require('os');
const { execFile } = require('child_process');

/**
 * Calcule l'usage CPU en pourcentage en comparant deux instantanés de
 * os.cpus() séparés d'un court délai (les temps cumulés depuis le démarrage
 * ne suffisent pas seuls : il faut une fenêtre pour obtenir un taux instantané).
 */
function sampleCpuTimes() {
  return os.cpus().map((core) => {
    const { user, nice, sys, idle, irq } = core.times;
    const total = user + nice + sys + idle + irq;
    return { idle, total };
  });
}

function getCpuUsage(sampleWindowMs = 300) {
  return new Promise((resolve) => {
    const start = sampleCpuTimes();

    setTimeout(() => {
      const end = sampleCpuTimes();

      const perCore = start.map((s, i) => {
        const e = end[i];
        const idleDelta = e.idle - s.idle;
        const totalDelta = e.total - s.total;
        const usage = totalDelta > 0 ? 1 - idleDelta / totalDelta : 0;
        return Math.max(0, Math.min(1, usage));
      });

      const overall = perCore.length > 0 ? perCore.reduce((a, b) => a + b, 0) / perCore.length : 0;

      resolve({
        overallPercent: Math.round(overall * 1000) / 10, // une décimale
        perCorePercent: perCore.map((u) => Math.round(u * 1000) / 10),
        model: os.cpus()[0]?.model || 'Inconnu',
      });
    }, sampleWindowMs);
  });
}

function getMemoryUsage() {
  const totalBytes = os.totalmem();
  const freeBytes = os.freemem();
  const usedBytes = totalBytes - freeBytes;

  return {
    totalBytes,
    usedBytes,
    freeBytes,
    usedPercent: totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 1000) / 10 : 0,
  };
}

/**
 * Interroge les disques fixes locaux via PowerShell/CIM (aucune dépendance
 * npm native nécessaire, cohérent avec le reste de l'application).
 */
function getDiskUsage() {
  return new Promise((resolve) => {
    const script =
      'Get-CimInstance -ClassName Win32_LogicalDisk -Filter "DriveType=3" | ' +
      'Select-Object DeviceID,VolumeName,Size,FreeSpace | ConvertTo-Json -Compress';

    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, timeout: 8000 },
      (err, stdout) => {
        if (err) {
          resolve([]); // best effort : on n'affiche simplement pas les disques plutôt que de planter
          return;
        }

        try {
          let parsed = JSON.parse(stdout);
          if (!Array.isArray(parsed)) parsed = [parsed]; // un seul disque -> objet, pas tableau

          const disks = parsed
            .filter((d) => d && d.DeviceID && typeof d.Size === 'number')
            .map((d) => {
              const totalBytes = d.Size || 0;
              const freeBytes = d.FreeSpace || 0;
              const usedBytes = totalBytes - freeBytes;
              return {
                drive: d.DeviceID,
                name: (d.VolumeName || '').trim(),
                totalBytes,
                usedBytes,
                freeBytes,
                usedPercent: totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 1000) / 10 : 0,
              };
            });

          resolve(disks);
        } catch (e) {
          resolve([]);
        }
      }
    );
  });
}

/**
 * Interroge le(s) GPU via WMI (nom, mémoire vidéo) et, quand disponible, le
 * compteur de performance Windows utilisé par le Gestionnaire des tâches pour
 * le taux d'utilisation 3D. Ce compteur n'est pas garanti disponible sur toutes
 * les configurations (pilote, permissions...) : on se contente alors du nom et
 * de la VRAM, sans faire échouer tout l'appel.
 */
function getGpuInfo() {
  return new Promise((resolve) => {
    const script = `
$ErrorActionPreference = 'SilentlyContinue'
$gpus = Get-CimInstance Win32_VideoController | Where-Object { $_.AdapterRAM -gt 0 } | Select-Object Name, AdapterRAM

$usage = $null
try {
  $samples = (Get-Counter '\\GPU Engine(*engtype_3D)\\Utilization Percentage' -ErrorAction Stop).CounterSamples
  if ($samples) {
    $usage = [math]::Round(($samples | Measure-Object -Property CookedValue -Sum).Sum, 1)
    if ($usage -gt 100) { $usage = 100 }
  }
} catch {}

$result = @()
foreach ($gpu in $gpus) {
  $result += [PSCustomObject]@{ name = $gpu.Name; vramBytes = $gpu.AdapterRAM }
}
[PSCustomObject]@{ gpus = $result; usagePercent = $usage } | ConvertTo-Json -Compress -Depth 4
`.trim();

    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, timeout: 8000 },
      (err, stdout) => {
        if (err) {
          resolve({ gpus: [], usagePercent: null });
          return;
        }

        try {
          const parsed = JSON.parse(stdout);
          let gpus = parsed.gpus || [];
          if (!Array.isArray(gpus)) gpus = [gpus]; // un seul GPU -> objet, pas tableau (piège classique de ConvertTo-Json)

          resolve({
            gpus: gpus.filter((g) => g && g.name).map((g) => ({ name: g.name, vramBytes: g.vramBytes || 0 })),
            usagePercent: typeof parsed.usagePercent === 'number' ? parsed.usagePercent : null,
          });
        } catch (e) {
          resolve({ gpus: [], usagePercent: null });
        }
      }
    );
  });
}

/**
 * Renvoie les processus qui consomment le plus (façon Gestionnaire des tâches) :
 * on échantillonne le temps CPU cumulé de chaque processus à 500 ms d'intervalle
 * pour obtenir un taux CPU instantané (rapporté à l'ensemble des cœurs), et on
 * remonte aussi la mémoire de travail. Les processus sont regroupés par nom
 * (ex: tous les "chrome" additionnés). Best-effort : en cas d'échec on renvoie [].
 */
function getTopProcesses() {
  return new Promise((resolve) => {
    const script = `
$ErrorActionPreference = 'SilentlyContinue'
$cpuCount = [Environment]::ProcessorCount
function Snap {
  Get-Process | Group-Object -Property ProcessName | ForEach-Object {
    [PSCustomObject]@{
      Name = $_.Name
      CPU  = (($_.Group | Measure-Object CPU -Sum).Sum)
      WS   = (($_.Group | Measure-Object WorkingSet64 -Sum).Sum)
    }
  }
}
$s1 = Snap
$t1 = @{}
foreach ($p in $s1) { $t1[$p.Name] = $p.CPU }
Start-Sleep -Milliseconds 500
$s2 = Snap
$res = foreach ($p in $s2) {
  $prev = $t1[$p.Name]
  $delta = if ($prev -ne $null) { $p.CPU - $prev } else { 0 }
  $pct = if ($delta -gt 0) { [math]::Round(($delta / (0.5 * $cpuCount)) * 100, 1) } else { 0 }
  if ($pct -gt 100) { $pct = 100 }
  [PSCustomObject]@{ name = $p.Name; cpuPercent = $pct; memBytes = [int64]$p.WS }
}
$res | Sort-Object @{Expression='cpuPercent';Descending=$true}, @{Expression='memBytes';Descending=$true} |
  Select-Object -First 6 | ConvertTo-Json -Compress -Depth 3
`.trim();

    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, timeout: 8000 },
      (err, stdout) => {
        if (err) {
          resolve([]);
          return;
        }
        try {
          let parsed = JSON.parse(stdout);
          if (!Array.isArray(parsed)) parsed = [parsed]; // un seul résultat -> objet
          const procs = parsed
            .filter((p) => p && p.name)
            .map((p) => ({
              name: p.name,
              cpuPercent: typeof p.cpuPercent === 'number' ? p.cpuPercent : 0,
              memBytes: p.memBytes || 0,
            }));
          resolve(procs);
        } catch (e) {
          resolve([]);
        }
      }
    );
  });
}

async function getSnapshot() {
  const [cpu, disks, gpu, processes] = await Promise.all([
    getCpuUsage(),
    getDiskUsage(),
    getGpuInfo(),
    getTopProcesses(),
  ]);
  const memory = getMemoryUsage();
  return { cpu, memory, disks, gpu, processes, timestamp: Date.now() };
}

module.exports = { getCpuUsage, getMemoryUsage, getDiskUsage, getGpuInfo, getTopProcesses, getSnapshot };
