param(
    [Parameter(Mandatory=$true)][string]$ExePath,
    [Parameter(Mandatory=$true)][string]$OutPath,
    [int]$Size = 256
)

Add-Type -AssemblyName System.Drawing

$code = @"
using System;
using System.Runtime.InteropServices;
using System.Drawing;
using System.Drawing.Imaging;

public static class JumboIcon
{
    // Interface COM du shell Windows exposant la liste d'images système (celle
    // qu'utilise l'Explorateur pour ses icônes). On ne déclare que les méthodes
    // jusqu'à GetIcon (incluse) : en interop COM par vtable, l'ordre doit être
    // exact depuis le début, mais il n'est pas nécessaire de déclarer les
    // méthodes suivantes qu'on n'appelle pas.
    [ComImport]
    [Guid("46EB5926-582E-4017-9FDF-E8998DAA0950")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IImageList
    {
        [PreserveSig] int Add(IntPtr hbmImage, IntPtr hbmMask, ref int pi);
        [PreserveSig] int ReplaceIcon(int i, IntPtr hicon, ref int pi);
        [PreserveSig] int SetOverlayImage(int iImage, int iOverlay);
        [PreserveSig] int Replace(int i, IntPtr hbmImage, IntPtr hbmMask);
        [PreserveSig] int AddMasked(IntPtr hbmImage, int crMask, ref int pi);
        [PreserveSig] int Draw(IntPtr pimldp);
        [PreserveSig] int Remove(int i);
        [PreserveSig] int GetIcon(int i, int flags, out IntPtr picon);
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct SHFILEINFO
    {
        public IntPtr hIcon;
        public int iIcon;
        public uint dwAttributes;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
        public string szDisplayName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 80)]
        public string szTypeName;
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    static extern IntPtr SHGetFileInfo(string pszPath, uint dwFileAttributes, ref SHFILEINFO psfi, uint cbFileInfo, uint uFlags);

    [DllImport("shell32.dll")]
    static extern int SHGetImageList(int iImageList, ref Guid riid, out IImageList ppv);

    [DllImport("user32.dll")]
    static extern bool DestroyIcon(IntPtr hIcon);

    const uint SHGFI_SYSICONINDEX = 0x4000;
    const int SHIL_JUMBO = 0x4;       // 256x256
    const int SHIL_EXTRALARGE = 0x2;  // 48x48 (repli si "jumbo" indisponible)
    const int ILD_TRANSPARENT = 1;

    /// <summary>
    /// Récupère l'icône "jumbo" (jusqu'à 256x256) d'un fichier via la liste
    /// d'images système du shell — exactement ce qu'affiche l'Explorateur
    /// Windows en grandes icônes. Contrairement à une construction manuelle
    /// depuis la mémoire brute d'un HBITMAP (ancienne approche), cette méthode
    /// renvoie un vrai HICON Windows, que GDI+ interprète nativement de façon
    /// fiable (orientation et transparence toujours correctes, quel que soit
    /// le format de stockage interne propre à chaque exécutable).
    /// </summary>
    public static bool SaveJumboIcon(string exePath, string outPath, int size)
    {
        try
        {
            var shfi = new SHFILEINFO();
            IntPtr sysIconResult = SHGetFileInfo(exePath, 0, ref shfi, (uint)Marshal.SizeOf(shfi), SHGFI_SYSICONINDEX);
            if (sysIconResult == IntPtr.Zero) return false;

            var iidImageList = new Guid("46EB5926-582E-4017-9FDF-E8998DAA0950");
            IImageList imageList;

            int hr = SHGetImageList(SHIL_JUMBO, ref iidImageList, out imageList);
            if (hr != 0)
            {
                hr = SHGetImageList(SHIL_EXTRALARGE, ref iidImageList, out imageList);
                if (hr != 0) return false;
            }

            IntPtr hIcon;
            imageList.GetIcon(shfi.iIcon, ILD_TRANSPARENT, out hIcon);
            if (hIcon == IntPtr.Zero) return false;

            try
            {
                using (var icon = Icon.FromHandle(hIcon))
                using (var bmp = icon.ToBitmap())
                {
                    bmp.Save(outPath, ImageFormat.Png);
                }
            }
            finally
            {
                DestroyIcon(hIcon);
            }

            return true;
        }
        catch
        {
            return false;
        }
    }
}
"@

Add-Type -TypeDefinition $code -ReferencedAssemblies System.Drawing

$ok = [JumboIcon]::SaveJumboIcon($ExePath, $OutPath, $Size)

if (-not $ok) {
    # Repli : icône associée classique (plus petite, mais toujours mieux que rien)
    try {
        $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($ExePath)
        if ($icon) {
            $bmp = $icon.ToBitmap()
            $bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
        }
    } catch {}
}
